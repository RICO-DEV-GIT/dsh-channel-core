import fs from 'node:fs';
import path from 'node:path';
import { PluginConfig } from './channel-plugin-settings/remote-config.js';
import { accountView, accountIdsOf } from './channel-plugin-settings/account-view.js';
import { ChannelRuntime } from './channel-runtime.js';
import { schema as discordSchema } from '../channels/discord/config.js';
import { createTransport as discordTransport } from '../channels/discord/transport.js';
import { schema as feishuSchema } from '../channels/feishu/config.js';
import { createTransport as feishuTransport } from '../channels/feishu/transport.js';
import { checkFeishuCredentials } from './feishu-credentials.js';

const channels=[
  {name:'discord',schema:discordSchema,service:'discordChannelSettings',
   credentialRefs:config=>[config.tokenRef]},
  {name:'feishu',schema:feishuSchema,service:'feishuChannelSettings',
   credentialRefs:config=>[config.appSecretRef],
   // A wrong pair otherwise only shows up as a handshake that never settles.
   credentialsCheck:checkFeishuCredentials},
];


/** Read real session statistics and the current instruction-file role name. */
export async function readSessionMetrics(ctx,sessionId,channelConfig={}){
  let values={};
  try{values=(await ctx.sessionController.projections({sessionId}))?.values??{};}catch{}
  let selected=values.modelSelection?.lastUsed??values.modelSelection?.next;
  if(!selected)try{selected=(await ctx.sessionController.modelCatalog())?.default;}catch{}
  let snapshot,live;
  try{
    live=ctx.get('sessions')?.get(sessionId);
    if(live)snapshot=ctx.get('tokenMeter')?.measure(live);
  }catch{}
  const preset=values.agentPreset??live?.header?.agentPreset??channelConfig.rolePreset??channelConfig.agentPreset;
  const roles=ctx.get('instructionFilesSettings')?.configFile?.value?.profiles??[];
  let roleName=typeof preset==='string'?roles.find(entry=>entry.preset===preset)?.name:undefined;
  if(!roleName&&typeof preset==='string')try{
    const roster=await ctx.get('agentPresets')?.list?.();
    roleName=roster?.find(row=>row.id===preset&&!row.broken)?.name;
  }catch{}
  const exact=v=>Number.isSafeInteger(v)&&v>=0?v:undefined;
  const projected=values.contextPressure??{},usage=values.tokenUsage??{};
  const contextTokens=exact(snapshot?.totalTokens)??exact(projected.projectedTokens)??exact(projected.pressureTokens);
  const contextLimitTokens=exact(projected.contextWindow);
  const inputTokens=exact(usage.uncachedInputTokens),outputTokens=exact(usage.outputTokens);
  const read=exact(usage.cacheReadTokens),write=exact(usage.cacheWriteTokens);
  const usagePresent=[inputTokens,outputTokens,read,write].some(x=>x!==undefined&&x>0);
  const cachePresent=read>0||write>0;
  return {
    ...(typeof roleName==='string'&&roleName.trim()?{agentName:roleName.trim()}:{}),
    ...(selected?.provider&&selected?.model?{model:selected.provider+'/'+selected.model}:{}),
    ...(contextTokens!==undefined?{contextTokens}:{}),
    ...(contextLimitTokens>0?{contextLimitTokens}:{}),
    ...(usagePresent?{inputTokens,outputTokens}:{}),
    ...(cachePresent?{cacheRead:read,cacheWrite:write}:{}),
  };
}

/** Copy old config into the single-package namespace without moving/deleting the original. */
export function migrateChannelConfigs(home) {
  const plugins=path.resolve(home,'..','plugins');
  const result=[];
  for(const {name} of channels){
    const previous=path.join(plugins,'dsh-channel-'+name,'config.json');
    const current=path.join(plugins,'dsh-channel-core','channels',name,'config.json');
    if(fs.existsSync(current)){result.push({name,result:'existing'});continue;}
    if(!fs.existsSync(previous)){result.push({name,result:'defaults'});continue;}
    fs.mkdirSync(path.dirname(current),{recursive:true});
    try{fs.copyFileSync(previous,current,fs.constants.COPYFILE_EXCL);result.push({name,result:'copied'});}
    catch(error){if(error.code==='EEXIST')result.push({name,result:'existing'});else throw error;}
  }
  return result;
}

/** The Core owns both adapters, but each keeps its own credentials, RPC service and lifecycle. */
export function registerChannelAdapters(ctx,core){
  const hosts=[];
  const specs=[
    {...channels[0],createTransport:(deps,sdk)=>discordTransport({...deps,host:{
      modelCatalog:()=>ctx.sessionController.modelCatalog(),
      projections:request=>ctx.sessionController.projections(request),
      selectModel:request=>ctx.sessionController.selectModel(request),
      runtimeMetrics:sessionId=>readSessionMetrics(ctx,sessionId,deps.config),
      defaultAgentName:()=>ctx.get('instructionFilesSettings')?.configFile?.value?.profiles?.find(row=>row.preset===(deps.config.rolePreset||deps.config.agentPreset))?.name,
    }},sdk)},
    {...channels[1],createTransport:(deps,sdk)=>feishuTransport({...deps,host:{
      runtimeMetrics:sessionId=>readSessionMetrics(ctx,sessionId,deps.config),
      defaultAgentName:()=>ctx.get('instructionFilesSettings')?.configFile?.value?.profiles?.find(row=>row.preset===(deps.config.rolePreset||deps.config.agentPreset))?.name,
      // Taps on the /model picker card come back through here.
      modelPicker:request=>core.modelPickerUpdate(request),
    }},sdk)},
  ];
  for(const spec of specs){
    let runtime;
    const settings=new PluginConfig(ctx,{
      service:spec.service,packageName:'dsh-channel-core/channels/'+spec.name,
      schema:spec.schema,details:()=>runtime?.details(),action:()=>runtime.reconfigure(),
      botCard:()=>runtime?.botCard?.(),
      registration:()=>runtime?.registration?.(),
      presetCatalog:()=>runtime?.presetCatalog?.(),
    });
    // One runtime per bot account. A v1 file yields the single implicit account,
    // so a profile that never adds a second bot keeps behaving exactly as before;
    // every runtime reads its own slice through the view, which is what keeps
    // transports, owners and bindings apart.
    const accounts=accountIdsOf(settings.configFile.value);
    const runtimes=accounts.map(accountId=>new ChannelRuntime(ctx,{configFile:accountView(settings.configFile,accountId)},{
      provider:spec.name,credentialRefs:spec.credentialRefs,createTransport:spec.createTransport,core,
      credentialsCheck:spec.credentialsCheck,
    }));
    // The settings service still talks to one account for now (M3 makes every RPC
    // account-aware); the default account is the natural choice.
    runtime=runtimes[0];
    hosts.push(...runtimes);
    ctx.effect(()=>{for(const instance of runtimes)void instance.reconfigure();return()=>Promise.all(runtimes.map(instance=>instance.close())).then(()=>{});});
  }
  return hosts;
}
