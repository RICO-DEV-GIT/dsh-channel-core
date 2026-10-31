import fs from 'node:fs';
import path from 'node:path';
import { PluginConfig } from './channel-plugin-settings/remote-config.js';
import { accountView, accountIdsOf, isMultiAccountConfig } from './channel-plugin-settings/account-view.js';
import { addAccount, removeAccount, credentialUnusedAfterRemoval, resolveWorkspaceBase } from './accounts.js';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** This plugin's own directory, used as the workspace root when G:\DSWork is absent. */
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    // Everything a bot account owns is keyed by its id, so one Map is the whole
    // picture: create/remove only has to add or delete one entry.
    const live=new Map();
    const settings=new PluginConfig(ctx,{
      service:spec.service,packageName:'dsh-channel-core/channels/'+spec.name,
      schema:spec.schema,provider:spec.name,
      runtimes:()=>live,
      presetCatalog:()=>live.values().next().value?.presetCatalog?.(),
      accounts:{
        async create({appId}){
          const before=settings.configFile.snapshot();
          // One root for every bot: G:\DSWork when present, otherwise this plugin's
          // own install directory, always with the App ID as the folder name.
          const base=await resolveWorkspaceBase({fallback:pluginRoot});
          const {value,accountId,workspacePath:assigned}=addAccount(before.value,{appId,base});
          // The session workspace must exist before DSH opens a Session in it.
          try{await mkdir(assigned,{recursive:true});}
          catch(error){throw Object.assign(new Error('无法创建工作区 '+assigned+'：'+(error?.message||'未知原因')),{code:'workspace-create-failed'});}
          settings.configFile.save(value,before.revision);
          mount(accountId);
          return {accountId,workspacePath:assigned,accounts:settings.accountsList()};
        },
        async remove(accountId){
          const before=settings.configFile.snapshot();
          const {value,removed}=removeAccount(before.value,accountId);
          // Persist first: if the write is refused (revision conflict) the account
          // must stay alive rather than be left configured but disconnected.
          settings.configFile.save(value,before.revision);
          const runtime=live.get(accountId);
          await runtime?.close();
          live.delete(accountId);
          const purged=core.store?.purgeAccount?.(spec.name,accountId)??null;
          const credentialFree=credentialUnusedAfterRemoval(value,removed.appSecretRef)?removed.appSecretRef:null;
          return {removed:true,purged,credentialRef:credentialFree,accounts:settings.accountsList()};
        },
      },
    });
    const mount=accountId=>{
      if(live.has(accountId))return live.get(accountId);
      const runtime=new ChannelRuntime(ctx,{configFile:accountView(settings.configFile,accountId)},{
        provider:spec.name,credentialRefs:spec.credentialRefs,createTransport:spec.createTransport,core,
        credentialsCheck:spec.credentialsCheck,
      });
      live.set(accountId,runtime);
      hosts.push(runtime);
      void runtime.reconfigure();
      return runtime;
    };
    // Leftovers from the old "create an empty account, bind later" flow are
    // useless: an account without a bot has no workspace owner, no sessions and
    // no way to ever connect. Drop them at startup instead of showing rows that
    // can never work.
    const pruneUnbound=()=>{
      const value=settings.configFile.value;
      if(!isMultiAccountConfig(value))return;
      const entries=Object.entries(value.accounts??{});
      const keep=entries.filter(([,account])=>String(account?.appId??'').trim());
      if(!keep.length||keep.length===entries.length)return;
      const next={...value,
        accounts:Object.fromEntries(keep),
        defaultAccount:keep.some(([id])=>id===value.defaultAccount)?value.defaultAccount:keep[0][0]};
      try{settings.configFile.save(next,settings.configFile.snapshot().revision);settings.configFile.reload();}
      catch(error){console.warn('[channel-core] prune unbound accounts failed',error?.message);}
    };
    pruneUnbound();
    for(const accountId of accountIdsOf(settings.configFile.value))mount(accountId);
    ctx.effect(()=>()=>Promise.all([...live.values()].map(instance=>instance.close())).then(()=>{}));
  }
  return hosts;
}
