import fs from 'node:fs';
import path from 'node:path';
import { PluginConfig } from './channel-plugin-settings/remote-config.js';
import { accountView, accountIdsOf, isMultiAccountConfig } from './channel-plugin-settings/account-view.js';
import { addAccount, removeAccount, credentialUnusedAfterRemoval, resolveWorkspaceBase, workspaceFor, assertAppId, DEFAULT_WORKSPACE_BASE, FALLBACK_WORKSPACE_DIR } from './accounts.js';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** This plugin's own directory, used as the workspace root when G:\DSWork is absent. */
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** One source of truth for the workspace root, usable from synchronous code. */
function workspaceBaseSync() {
  return fs.existsSync(DEFAULT_WORKSPACE_BASE) ? DEFAULT_WORKSPACE_BASE : path.join(pluginRoot, FALLBACK_WORKSPACE_DIR);
}

/** Windows paths differ in case and separators; compare them resolved. */
function samePath(left, right) {
  const normalise = value => path.resolve(String(value ?? '')).replace(/[\\/]+$/, '').toLowerCase();
  return Boolean(left) && normalise(left) === normalise(right);
}
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


/**
 * The Host's session API is (request, signal) and calls signal.throwIfAborted()
 * unconditionally, so every call must carry one or it throws a TypeError.
 */
const hostSignal = signal => signal ?? new AbortController().signal;

/** Read real session statistics and the current instruction-file role name. */
export async function readSessionMetrics(ctx,sessionId,channelConfig={}){
  let values={};
  try{values=(await ctx.sessionController.projections({sessionId},hostSignal()))?.values??{};}catch{}
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
      // The Host's session API calls signal.throwIfAborted() unconditionally, so a
      // missing signal is a TypeError, not a no-op: always hand one over.
      projections:(request,signal)=>ctx.sessionController.projections(request,hostSignal(signal)),
      selectModel:(request,signal)=>ctx.sessionController.selectModel(request,hostSignal(signal)),
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
      // Saves never carry a workspace (the field is not editable); the server
      // restores it from the App ID, which is the single source of the folder name.
      deriveWorkspace:appId=>workspaceFor(workspaceBaseSync(),appId),
      presetCatalog:()=>live.values().next().value?.presetCatalog?.(),
      accounts:{
        async create({appId}){
          const before=settings.configFile.snapshot();
          // One root for every bot: G:\DSWork when present, otherwise this plugin's
          // own directory + DSWork, always with the App ID as the folder name.
          const base=workspaceBaseSync();
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
          // The bot's own folder existed only for this bot: remove it, but never a
          // directory the operator pointed at by hand (that path is not derived from
          // the App ID) and never one that another bot still uses.
          const derived=String(removed?.appId??'').trim()?workspaceFor(workspaceBaseSync(),String(removed.appId).trim()):'';
          const used=String(removed?.workspacePath??'').trim();
          let workspaceRemoved=false;
          if(derived&&used&&path.resolve(derived).toLowerCase()===path.resolve(used).toLowerCase()){
            const sharedBySibling=Object.values(value.accounts??{}).some(account=>
              String(account?.workspacePath??'').trim()&&path.resolve(account.workspacePath).toLowerCase()===path.resolve(used).toLowerCase());
            if(!sharedBySibling){
              try{fs.rmSync(used,{recursive:true,force:true});workspaceRemoved=true;}
              catch(error){console.warn('[channel-core] workspace remove failed',used,error?.message);}
            }
          }
          const credentialFree=credentialUnusedAfterRemoval(value,removed.appSecretRef)?removed.appSecretRef:null;
          return {removed:true,purged,workspaceRemoved,credentialRef:credentialFree,accounts:settings.accountsList()};
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
    // Only legacy values are lined up with the derived folder: an empty path, or the
    // old shared root. A directory the operator chose on purpose is left alone —
    // otherwise a restart would silently undo "修改工作区目录".
    const normalizeWorkspaces=()=>{
      const value=settings.configFile.value;
      if(!isMultiAccountConfig(value))return;
      const base=workspaceBaseSync();
      const accounts={...value.accounts};
      let changed=false;
      for(const [id,account] of Object.entries(accounts)){
        let expected;
        try{expected=workspaceFor(base,assertAppId(account?.appId));}
        catch{continue;}
        const current=String(account?.workspacePath??'').trim();
        const legacy=!current||samePath(current,base);
        if(!legacy){continue;}
        try{fs.mkdirSync(expected,{recursive:true});}
        catch(error){console.warn('[channel-core] workspace mkdir failed',expected,error?.message);continue;}
        if(samePath(current,expected))continue;
        accounts[id]={...account,workspacePath:expected};
        changed=true;
      }
      if(!changed)return;
      try{settings.configFile.save({...value,accounts},settings.configFile.snapshot().revision);settings.configFile.reload();}
      catch(error){console.warn('[channel-core] workspace normalize failed',error?.message);}
    };
    pruneUnbound();
    normalizeWorkspaces();
    for(const accountId of accountIdsOf(settings.configFile.value))mount(accountId);
    ctx.effect(()=>()=>Promise.all([...live.values()].map(instance=>instance.close())).then(()=>{}));
  }
  return hosts;
}
