import path from 'node:path';
import { defineConfig } from '../../lib/channel-plugin-settings/remote-config.js';
import { ConfigError } from '../../lib/channel-plugin-settings/file-config.js';
const ref=v=>/^[A-Z_][A-Z0-9_]*$/.test(v);
const id=v=>v.trim().length>0&&v.length<=256&&!/[\x00-\x1f]/.test(v);
const progressDefaults={toolProgress:true,commentary:true,draft:true,narration:false,toolDetail:true,maxLines:9,maxLineChars:240,draftMaxChars:600};
const footerDefaults={status:false,elapsed:false,model:true,context:true,tokens:false,cache:false};
const invalid=()=>{throw new ConfigError('invalid-config','streaming 配置无效，请检查回复模式及进度选项');};
function streaming(value){
  if(typeof value==='boolean')value={mode:value?'progress':'off'};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['mode','progress','footer','cardEngine','finalFormat'].includes(key)))invalid();
  const mode=Object.hasOwn(value,'mode')?value.mode:'progress',input=Object.hasOwn(value,'progress')?value.progress:{};
  if(!['off','partial','progress'].includes(mode)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(progressDefaults,key)))invalid();
  const footerInput=Object.hasOwn(value,'footer')?value.footer:{};
  if(!footerInput||typeof footerInput!=='object'||Array.isArray(footerInput)||Object.keys(footerInput).some(key=>!Object.hasOwn(footerDefaults,key)))invalid();
  const footer={...footerDefaults,...footerInput};
  if(Object.values(footer).some(v=>typeof v!=='boolean'))invalid();
  const progress={...progressDefaults,...input};
  if(typeof progress.toolProgress!=='boolean'||typeof progress.commentary!=='boolean'||typeof progress.draft!=='boolean'||typeof progress.narration!=='boolean'||typeof progress.toolDetail!=='boolean'||!Number.isSafeInteger(progress.maxLines)||progress.maxLines<1||progress.maxLines>12||!Number.isSafeInteger(progress.maxLineChars)||progress.maxLineChars<40||progress.maxLineChars>300||!Number.isSafeInteger(progress.draftMaxChars)||progress.draftMaxChars<120||progress.draftMaxChars>1000)invalid();
  const cardEngine=value.cardEngine??'cardkit';
  if(!['cardkit','patch'].includes(cardEngine))invalid();
  // `text` sends the final answer as a normal message: on a phone a long card
  // has to be opened before its text can be selected, which is what makes
  // copying hard. `auto` applies that to private chats only (the conversation a
  // phone user actually reads), and keeps the card for groups, where the answer
  // is read by several people and the card's structure helps. `card` is the
  // historical behaviour and stays available as an explicit opt-out.
  const finalFormat=value.finalFormat??'auto';
  if(!['auto','card','text'].includes(finalFormat))invalid();
  return {mode,progress,footer,cardEngine,finalFormat};
}
const base=defineConfig({
  enabled:false,accountId:'default',appId:'',domain:'feishu',appSecretRef:'FEISHU_APP_SECRET',allowedUsers:[],allowGroups:false,autoCollectGroups:false,allowedGroups:[],requireMention:true,
  inputMode:'inherit',agentPreset:'',rolePreset:'',workspacePath:'',memoryNamespace:'private',identityLinks:[],ownerMode:'first-dm',ownerUserId:'',
  streaming:streaming({mode:'progress'}),throttleMs:750,attachments:true,maxAttachmentMB:10
},{accountId:id,appSecretRef:ref,inputMode:v=>['inherit','steering','queue','interrupt'].includes(v),domain:v=>['feishu','lark'].includes(v),workspacePath:v=>v===''||path.isAbsolute(v),memoryNamespace:id,ownerMode:v=>['first-dm','manual'].includes(v),ownerUserId:(v,c)=>v===''?c.ownerMode==='first-dm':id(v),agentPreset:v=>v===''||id(v),rolePreset:v=>v===''||id(v),allowedUsers:v=>v.length<=1000&&v.every(id),allowedGroups:v=>v.length<=1000&&v.every(id),autoCollectGroups:v=>typeof v==='boolean',identityLinks:v=>v.length<=1000&&v.every(s=>s.includes('=')&&s.split('=').length===2&&s.split('=').every(id)),throttleMs:v=>Number.isSafeInteger(v)&&v>=400&&v<=5000,maxAttachmentMB:v=>Number.isSafeInteger(v)&&v>=1&&v<=20});
/**
 * Multi-account (v2) shape: `{ schemaVersion: 2, defaultAccount, accounts, shared }`.
 *
 * The v1 flat object stays fully supported: a profile with one bot keeps writing
 * v1, so `v0.8.x` files and every existing test keep working. v2 is only used
 * once a second account exists (see `migrateToMultiAccount`), which is also what
 * keeps the rollback path simple — a v1 file is never rewritten by this code
 * until the operator actually adds a bot.
 */
const ACCOUNT_RULES={
  appSecretRef:ref,inputMode:v=>['inherit','steering','queue','interrupt'].includes(v),
  domain:v=>['feishu','lark'].includes(v),workspacePath:v=>v===''||path.isAbsolute(v),
  memoryNamespace:id,ownerMode:v=>['first-dm','manual'].includes(v),
  ownerUserId:(v,c)=>v===''?c.ownerMode==='first-dm':id(v),
  agentPreset:v=>v===''||id(v),rolePreset:v=>v===''||id(v),
  allowedUsers:v=>v.length<=1000&&v.every(id),allowedGroups:v=>v.length<=1000&&v.every(id),
  autoCollectGroups:v=>typeof v==='boolean',
  identityLinks:v=>v.length<=1000&&v.every(s=>s.includes('=')&&s.split('=').length===2&&s.split('=').every(id)),
  attachments:v=>typeof v==='boolean',maxAttachmentMB:v=>Number.isSafeInteger(v)&&v>=1&&v<=20,
};
const ACCOUNT_FIELDS=Object.freeze({
  enabled:false,appId:'',domain:'feishu',appSecretRef:'FEISHU_APP_SECRET',allowedUsers:[],allowGroups:false,
  autoCollectGroups:false,allowedGroups:[],requireMention:true,inputMode:'inherit',agentPreset:'',rolePreset:'',
  workspacePath:'',memoryNamespace:'private',identityLinks:[],ownerMode:'first-dm',ownerUserId:'',
  attachments:true,maxAttachmentMB:10,
});
const SHARED_FIELDS=Object.freeze({throttleMs:750});
const ACCOUNT_ID=/^[A-Za-z0-9_-]{1,64}$/;

export function isMultiAccount(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Boolean(value.accounts);}

function validateAccount(raw,accountId){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ConfigError('invalid-config','账号配置必须是对象：'+accountId);
  // `accountId` is the map key, `schemaVersion` is the object-level version. Both
  // are dropped silently so a migrated v1 slice validates.
  const {accountId:_ignoredAccountId,schemaVersion:_ignoredVersion,...input}=raw;
  // Display options are shared, not per account: accepting them here would let an
  // operator "set" something that silently does nothing.
  for(const key of ['streaming','throttleMs'])
    if(Object.hasOwn(input,key))throw new ConfigError('invalid-config','账号「'+accountId+'」不能单独设置 '+key+'，请写在 shared 里');
  for(const key of Object.keys(input))if(!Object.hasOwn(ACCOUNT_FIELDS,key))throw new ConfigError('invalid-config','未知的账号配置项：'+accountId+'.'+key);
  const value={...structuredClone(ACCOUNT_FIELDS),...structuredClone(input)};
  for(const [key,rule] of Object.entries(ACCOUNT_RULES))if(!rule(value[key],value))throw new ConfigError('invalid-config','账号配置项无效：'+accountId+'.'+key);
  return Object.freeze(value);
}

function validateShared(raw){
  if(raw!==undefined&&(raw===null||typeof raw!=='object'||Array.isArray(raw)))throw new ConfigError('invalid-config','shared 必须是对象');
  const input=raw??{};
  for(const key of Object.keys(input))if(!Object.hasOwn(SHARED_FIELDS,key)&&key!=='streaming')throw new ConfigError('invalid-config','未知的 shared 配置项：'+key);
  const value={...structuredClone(SHARED_FIELDS),...structuredClone(input)};
  value.streaming=streaming(Object.hasOwn(input,'streaming')?input.streaming:base.defaults.streaming);
  if(!Number.isSafeInteger(value.throttleMs)||value.throttleMs<400||value.throttleMs>5000)throw new ConfigError('invalid-config','配置项取值无效：shared.throttleMs');
  return Object.freeze(value);
}

function validateMulti(input){
  const accounts=Object.entries(input.accounts??{});
  if(!accounts.length)throw new ConfigError('invalid-config','至少需要配置一个机器人账号');
  const checked={};
  for(const [accountId,raw] of accounts){
    if(!ACCOUNT_ID.test(accountId))throw new ConfigError('invalid-config','账号 ID 只能包含字母、数字、下划线和短横线：'+accountId);
    checked[accountId]=validateAccount(raw,accountId);
  }
  const defaultAccount=String(input.defaultAccount??'');
  if(defaultAccount&&!Object.hasOwn(checked,defaultAccount))throw new ConfigError('invalid-config','默认账号不存在：'+defaultAccount);
  return Object.freeze({
    schemaVersion:2,
    defaultAccount:defaultAccount||Object.keys(checked)[0],
    accounts:Object.freeze(checked),
    shared:validateShared(input.shared),
  });
}

/**
 * Turn a v1 flat config into the v2 multi-account shape.
 * The old object becomes `accounts[accountId]`; display/streaming options move to
 * `shared`. Nothing is guessed beyond that.
 */
export function migrateToMultiAccount(v1,{accountId='default'}={}){
  const flat=base.validate({...v1,streaming:streaming(v1?.streaming??base.defaults.streaming)});
  const {streaming:streamValue,throttleMs,schemaVersion:_version,accountId:_legacyId,...rest}=flat;
  return validateMulti({
    schemaVersion:2,
    defaultAccount:accountId,
    accounts:{[accountId]:rest},
    shared:{streaming:streamValue,throttleMs},
  });
}

/** Next free account id: account-2, account-3, … */
export function nextAccountId(accounts){
  const used=new Set(Object.keys(accounts??{}));
  if(!used.has('default'))return 'default';
  for(let index=2;index<1000;index++)if(!used.has('account-'+index))return 'account-'+index;
  throw new ConfigError('invalid-config','账号数量过多');
}

export const schema={defaults:base.defaults,validate(input){
  if(isMultiAccount(input))return validateMulti(input);
  if(!input||typeof input!=='object'||Array.isArray(input))return base.validate(input);
  return base.validate({...input,streaming:streaming(Object.hasOwn(input,'streaming')?input.streaming:base.defaults.streaming)});
}};
