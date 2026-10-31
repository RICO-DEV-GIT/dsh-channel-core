import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const plugins=path.resolve(here,'..');
// A Windows checkout hands us CRLF; the template markers are written with LF,
// so normalize before slicing instead of failing the build on line endings.
const lf=text=>text.replaceAll('\r\n','\n');
const source=lf(fs.readFileSync(path.join(here,'client.template.js'),'utf8'));
const common=lf(fs.readFileSync(path.join(plugins,'tools/settings/settings-client.inc.js'),'utf8'));
const helpers=common.split('function installConfigPage(ctx, options) {')[0];
if(!helpers.includes('function FileConfigPage')||!helpers.includes('function CredentialsPage'))throw Error('shared config client changed');
// The published bundle is the artifact users already run. Its sources drifted
// once: the helper lacked the multiline "restore default" editor and the
// template still carried a retired view, so a rebuild silently regressed the
// settings page. Refuse to build instead of rewriting that silently.
if(!common.includes('dpc-prompt-editor'))throw Error('settings helper lost the multiline default-restore editor; the published bundle still has it');
if(source.includes('NewsArchiveView'))throw Error('client template still carries the retired outbound-archive view; remove it before rebuilding');
const cssStart=common.indexOf('style.textContent = `');
const cssEnd=common.indexOf('`;\n',cssStart);
if(cssStart<0||cssEnd<0)throw Error('shared CSS not found');
const css=common.slice(cssStart+'style.textContent = `'.length,cssEnd).replaceAll('${options.packageName}','dsh-channel-core');
const pages=JSON.parse(fs.readFileSync(path.join(plugins,'tools/settings/pages.json'),'utf8'));
const adapt={
  discord:{...pages['dsh-channel-discord'],packageName:'dsh-channel-core',endpoint:'discordChannelSettings'},
  feishu:{...pages['dsh-channel-feishu'],packageName:'dsh-channel-core',endpoint:'feishuChannelSettings'},
};
if(adapt.discord.fields.length<5||adapt.feishu.fields.length<5)throw Error('missing channel settings');
const clientComponent=`const bundledChannelPanels=${JSON.stringify(adapt)};
  const bundledConfigCss=${JSON.stringify(css)};
  const botCss='.dcb-bot{margin:0 0 22px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.dcb-bot-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.dcb-bot-head h3{margin:0 0 6px;font-size:15px}.dcb-bot-head p{margin:0;max-width:44em;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-bot-btn,.dcb-bot-copy{padding:7px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer;font-size:13px}.dcb-bot-btn:disabled{opacity:.6;cursor:default}.dcb-bot-body{display:flex;gap:18px;align-items:center;margin-top:16px;flex-wrap:wrap}.dcb-bot-body img{border-radius:8px;background:#fff;flex:0 0 auto}.dcb-bot-meta{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1 1 220px}.dcb-bot-link{font-size:12px;word-break:break-all;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-bot-msg{margin:12px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary,#8a8f99)}';
  const regCss='.dcb-reg{margin:0 0 22px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.dcb-reg-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.dcb-reg-head h3{margin:0 0 6px;font-size:15px}.dcb-reg-head p{margin:0;max-width:44em;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-reg-body{display:flex;gap:18px;align-items:center;margin-top:16px;flex-wrap:wrap}.dcb-reg-body img{border-radius:8px;background:#fff;flex:0 0 auto}.dcb-reg-msg{margin:12px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-reg-err{color:var(--dsw-alias-state-error-primary,#d64545)}.dcb-preset{margin:0 0 16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-preset code{color:inherit;font-size:12px}.dcb-preset-warn{border-color:var(--dsw-alias-state-error-primary,#d64545);color:var(--dsw-alias-state-error-primary,#d64545)}.dcb-bot-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}.dcb-checklist{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);font-size:12px;line-height:1.8;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-checklist-head{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.dcb-checklist ol{margin:8px 0 0;padding-left:20px}.dcb-checklist li{margin:4px 0}.dcb-health{margin:0 0 14px;padding:12px 14px;border:1px solid var(--dsw-alias-state-error-primary,#d64545);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.9;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-health strong{display:block;margin-bottom:4px;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px}.dcb-health ul{margin:0;padding:0;list-style:none;display:grid;gap:6px}.dcb-health li{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.dcb-health .dcb-ok{opacity:.75}.dcb-health-form{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}.dcb-health-form input{box-sizing:border-box;min-width:180px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.dcb-workspace{border-color:var(--dsw-alias-border-l2);margin-top:0;margin-bottom:14px}.dcb-workspace .dcb-health-head{justify-content:space-between;align-items:center}.dcb-workspace strong{font-size:12px;font-weight:500}.dcb-add-workspace{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 2px;font-size:12px;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-add-tabs{display:flex;gap:8px;margin:8px 0}.dcb-add-tab{padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer;font-size:12px}.dcb-add-tab-on{border-color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}.dcb-manual{display:grid;gap:8px;margin:8px 0;max-width:420px}.dcb-manual input{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.dcb-accounts{margin:0 0 14px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;font-size:12px;line-height:1.8}.dcb-accounts ul{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:10px}.dcb-account{display:grid;gap:6px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}.dcb-account-main{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.dcb-account-main code{font-size:11px;opacity:.8}';
  // One entry for the whole Feishu bot lifecycle: scan to create/connect,
  // paste existing credentials, then — once connected — scan to open the chat.
  // Two cards made the operator guess which QR to press; the state now decides.
  /**
   * Which bot account the settings form is editing. The bot panel owns the list
   * (it is the only place that can create/delete accounts) and the form follows,
   * so "switch account" is one control, not two.
   */
  const accountSelection={id:'',listeners:new Set(),
    get(){return this.id;},
    set(id){if(this.id===id)return;this.id=id;for(const fn of this.listeners)fn();},
    subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}};
  const useSelectedAccount=()=>React.useSyncExternalStore(
    React.useCallback(fn=>accountSelection.subscribe(fn),[]),
    React.useCallback(()=>accountSelection.get(),[]),
    React.useCallback(()=>accountSelection.get(),[]),
  );
  /**
   * A scope-shaped view over one account: same methods the settings widgets
   * already use, but every call carries accountId and the snapshot holds that
   * account's slice. Keeps the form code unchanged.
   */
  function createAccountScope(base,accountId){
    const listeners=new Set();
    let state={status:'loading',writable:true};
    const publish=next=>{state=next;for(const fn of listeners)fn();};
    const SCOPED=new Set(['getConfig','setConfig','runAction','botCard','registrationBegin','registrationPoll','registrationApply']);
    const call=(method,args)=>{
      const payload=SCOPED.has(method)?{accountId,...(args??{})}:args;
      return base.call(method,payload);
    };
    return {
      getSnapshot:()=>state,
      subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
      async reload(){const result=await call('getConfig',{});publish({...result,status:'ready'});return result;},
      async update(value,revision){const result=await call('setConfig',{value,revision:revision??state.revision});publish({...result,status:'ready'});return result;},
      async runAction(){const result=await call('runAction',{});publish({...result,status:'ready'});return result;},
      call,
      close(){listeners.clear();},
    };
  }
  function FeishuBotPanel({scope:rootScope,credentialApi}) {
    const selected=useSelectedAccount();
    const scope=React.useMemo(()=>selected?createAccountScope(rootScope,selected):rootScope,[rootScope,selected]);
    React.useEffect(()=>{
      if(scope===rootScope)return undefined;
      void scope.reload().catch(()=>{});
      return ()=>scope.close();
    },[scope,rootScope]);
    const snapshot=useFileConfig(scope);
    const config=snapshot?.value??{};
    const connected=(snapshot?.details??{}).connected===true;
    const appId=String(config.appId??'').trim();
    const secretRef=String(config.appSecretRef||'FEISHU_APP_SECRET');
    // Feedback that is not a form error (copy result, retry result) gets its own
    // slot instead of borrowing the credential form's message line.
    const [notice,setNotice]=React.useState('');
    const [checklist,setChecklist]=React.useState(false);
    // First-run health: the three things that make a scan useless when missing
    // (switch off, credentials absent, no workspace). Each failing row offers
    // the fix in place instead of waiting for a failure message later.
    const [credentialReady,setCredentialReady]=React.useState(null);
    React.useEffect(()=>{
      let alive=true;
      if(!credentialApi){setCredentialReady(null);return undefined;}
      credentialApi.describe([secretRef]).then(result=>{
        if(!alive)return;
        setCredentialReady(result&&result.ok?(result.value&&result.value[secretRef]&&result.value[secretRef].configured===true):null);
      }).catch(()=>{if(alive)setCredentialReady(null);});
      return ()=>{alive=false;};
    },[credentialApi,secretRef]);
    const workspaceValue=String(config.workspacePath||'').trim()||String((snapshot?.details??{}).workspacePath||'').trim();
    // The workspace is NOT listed here: it has its own always-visible line below,
    // and listing it twice produced two competing "pick a directory" buttons.
    const health=[
      {key:'enabled',ok:config.enabled===true,label:'已开启「连接渠道」'},
      {key:'credential',ok:!!appId&&credentialReady===true,label:'App ID 与密钥已就绪'},
    ];
    const healthBlock=()=>{
      if(!health.some(row=>!row.ok))return null;
      return e('div',{className:'dcb-health'},
        e('strong',null,'首次使用还差这几项'),
        e('ul',null,health.map(row=>e('li',{key:row.key,className:row.ok?'dcb-ok':'dcb-todo'},
          e('span',null,(row.ok?'✅ ':'⚠️ ')+row.label),
          row.ok?null:(row.key==='enabled'
            ?e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{void enableChannel();}},'打开连接渠道')
            :e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{void startQuick();}},'快捷配置'))))));
    };
    // ---- multi-account management -------------------------------------------------
    const [accounts,setAccounts]=React.useState(null);
    const [accountBusy,setAccountBusy]=React.useState('');
    const [confirmDelete,setConfirmDelete]=React.useState('');
    const refreshAccounts=async()=>{
      try{const result=await scope.call('getConfig',{});setAccounts(result?.accounts??[]);}
      catch(error){setAccounts([]);setNotice('读取账号列表失败：'+error.message);}
    };
    React.useEffect(()=>{void refreshAccounts();},[scope]);
    // Keep the selection valid: first load picks the connected (default) account,
    // and deleting the selected one falls back to whatever remains.
    React.useEffect(()=>{
      const list=accounts??[];
      if(!list.length)return;
      if(!selected)accountSelection.set((list.find(row=>row.connected)??list[0]).id);
      else if(!list.some(row=>row.id===selected))accountSelection.set(list[0].id);
    },[accounts,selected]);
    // Switching accounts must not carry one account's half-finished work into
    // another: an in-flight scan would be applied to the newly selected account
    // (registration calls are scoped), and a typed path would be saved onto it.
    // The first automatic selection is not a switch, so it must not cancel a scan
    // the operator started while the account list was still loading.
    const prevSelected=React.useRef(null);
    const bootedSelection=React.useRef(false);
    React.useEffect(()=>{
      if(!selected)return;
      if(!bootedSelection.current){bootedSelection.current=true;prevSelected.current=selected;return;}
      if(prevSelected.current===selected)return;
      prevSelected.current=selected;
      setNotice('');
      // A scan in progress is not tied to any account yet; switching the editor
      // must not leave a QR that the operator thinks belongs to the new selection.
      stopAdd();
      setAddScan(null);
    },[selected]);
    React.useEffect(()=>()=>{if(addTimer.current)clearTimeout(addTimer.current);},[]);
    // ONE action adds one robot: choose its own workspace, scan, and only then is
    // the row created. Nothing is written before the phone confirms, so cancelling
    // or a failed scan cannot leave a half-added bot behind.
    const [addScan,setAddScan]=React.useState(null);
    const addTimer=React.useRef(null);
    const pendingWorkspace=React.useRef('');
    const stopAdd=()=>{if(addTimer.current){clearTimeout(addTimer.current);addTimer.current=null;}};
    React.useEffect(()=>()=>stopAdd(),[]);
    const addPoll=async(deviceCode,expiresAt)=>{
      let result;
      try{result=await scope.call('registrationPoll',{deviceCode});}
      catch(error){
        if(Date.now()<expiresAt){addTimer.current=setTimeout(()=>{void addPoll(deviceCode,expiresAt);},6000);return;}
        setAddScan({status:'error',qr:null,message:'轮询失败：'+error.message});return;
      }
      if(result.status==='success'){
        stopAdd();
        setAddScan({status:'saving',qr:null,message:'已扫码，正在保存并连接…'});
        let created=null;
        try{
          created=await scope.call('accountCreate',{appId:result.appId});
          const ref=created?.credentialRef;
          if(result.appSecret&&credentialApi&&ref){
            const saved=await credentialApi.set(ref,result.appSecret);
            if(!saved.ok)throw new Error(saved.error?.message||'保存密钥失败');
          }
          await scope.call('registrationApply',{appId:result.appId,openId:result.openId||'',domain:result.domain||'',accountId:created.accountId});
          const fresh=await scope.call('getConfig',{});
          setAccounts(fresh?.accounts??null);
          setAddScan(null);
          setNotice('已添加机器人 '+(result.appId||'')+'，工作区 '+(created.workspacePath||''));
          await scope.reload();
        }catch(error){
          // Never leave a row behind that cannot work: undo the account we created.
          if(created?.accountId){
            try{await scope.call('accountRemove',{accountId:created.accountId});}catch{}
            await refreshAccounts();
          }
          setAddScan({status:'error',qr:null,message:'添加失败：'+error.message});
        }
        return;
      }
      if(result.status==='pending'){
        if(Date.now()>=expiresAt){stopAdd();setAddScan({status:'error',qr:null,message:'二维码已过期，请重新点「+ 添加机器人」。'});return;}
        const wait=Math.max(5,result.slowDown?10:(result.interval??5));
        addTimer.current=setTimeout(()=>{void addPoll(deviceCode,expiresAt);},wait*1000);
        return;
      }
      stopAdd();
      setAddScan({status:'error',qr:null,message:result.message||'扫码未完成，请重试。'});
    };
    // Two ways to add, like the reference channel UI: scan (quick) or paste the
    // App ID + secret (manual). Neither asks for a workspace: it is derived from
    // the App ID as G:\DSWork\<appId>, so appId uniqueness gives folder uniqueness.
    const [addMode,setAddMode]=React.useState('quick');
    const [manualAppId,setManualAppId]=React.useState('');
    const [manualSecret,setManualSecret]=React.useState('');
    const startQuick=async()=>{
      setAccountBusy('add');
      try{
        setAddMode('quick');
        setManualAppId('');
        setManualSecret('');
        setAddScan({status:'begin',qr:null,message:'正在生成二维码…'});
        const begun=await scope.call('registrationBegin',{domain:'feishu'});
        if(!begun?.qr)throw new Error(begun?.message||'未返回二维码');
        setAddScan({status:'waiting',qr:begun.qr,message:'用手机飞书扫码；完成后会自动创建并连接'});
        void addPoll(begun.deviceCode,Date.now()+(begun.expiresIn??300)*1000);
      }catch(error){setAddScan({status:'error',qr:null,message:'生成二维码失败：'+error.message});}
      finally{setAccountBusy('');}
    };
    const startManual=async()=>{
      stopAdd();
      setAddMode('manual');
      setManualAppId('');
      setManualSecret('');
      setAddScan({status:'manual',qr:null,message:'填写飞书应用的 App ID 与 App Secret；工作区会自动创建为 G:\\DSWork\\<AppID>'});
    };
    const applyManual=async()=>{
      const appIdText=manualAppId.trim();
      const secret=manualSecret.trim();
      if(!appIdText||!secret){setAddScan({status:'error',qr:null,message:'请填写 App ID 和 App Secret'});return;}
      setAccountBusy('add');
      setAddScan({status:'saving',qr:null,message:'正在保存并连接…'});
      let created=null;
      try{
        created=await scope.call('accountCreate',{appId:appIdText});
        const saved=await credentialApi.set(created.credentialRef,secret);
        if(!saved.ok)throw new Error(saved.error?.message||'保存密钥失败');
        // Bind through the same path as a scan, so owner/allow rules and the
        // duplicate + workspace checks all run server-side.
        await scope.call('registrationApply',{appId:appIdText,openId:'',domain:'',accountId:created.accountId});
        await refreshAccounts();
        setAddScan(null);
        setNotice('已添加机器人 '+appIdText+'，工作区 '+(created.workspacePath||''));
        await scope.reload();
      }catch(error){
        if(created?.accountId){try{await scope.call('accountRemove',{accountId:created.accountId});}catch{}await refreshAccounts();}
        setAddScan({status:'error',qr:null,message:'添加失败：'+error.message});
      }
      finally{setAccountBusy('');}
    };
    const removeAccount=async accountId=>{
      setAccountBusy(accountId);
      try{
        const result=await scope.call('accountRemove',{accountId});
        setAccounts(result?.accounts??null);
        setConfirmDelete('');
        const credential=result?.credentialRef?'，凭证 '+result.credentialRef+' 已可清理':'';
        setNotice('已删除机器人 '+accountId+credential);
        await scope.reload();
      }catch(error){setNotice('删除机器人失败：'+error.message);}
      finally{setAccountBusy('');}
    };
    const accountsBlock=()=>{
      if(!accounts)return null;
      return e('div',{className:'dcb-accounts'},
        e('div',{className:'dcb-health-head'},
          e('strong',null,'机器人（'+accounts.length+'）'),
          // The two ways to add are the buttons themselves; there is no intermediate
          // "add" step and no tab to discover.
          e('div',{className:'dcb-bot-actions'},
            e('button',{type:'button',className:'dcb-bot-btn',disabled:accountBusy==='add',onClick:()=>{void startQuick();}},'快捷配置'),
            e('button',{type:'button',className:'dcb-bot-copy',disabled:accountBusy==='add',onClick:()=>{void startManual();}},'手动配置'))),
        e('p',{className:'dcb-bot-link'},accounts.length
          ?'每个机器人使用独立工作区（G:\\DSWork\\<AppID>）、独立会话；同一个机器人只能添加一次。'
          :'还没有机器人：点「快捷配置」扫码添加，或「手动配置」填入 App ID 与 App Secret。'),
        addScan?e('div',{className:'dcb-reg-body'},
          e('div',{className:'dcb-bot-meta'},
            addMode==='quick'
              ?e(React.Fragment,null,
                addScan.qr?e('img',{src:addScan.qr,alt:'飞书扫码二维码',width:200,height:200}):null,
                e('p',{className:'dcb-reg-msg'+(addScan.status==='error'?' dcb-reg-err':'')},addScan.message))
              :e('div',{className:'dcb-manual'},
                e('input',{type:'text',value:manualAppId,placeholder:'飞书应用的 App ID',onChange:event=>setManualAppId(event.target.value),'aria-label':'App ID'}),
                e('input',{type:'password',value:manualSecret,autoComplete:'new-password',placeholder:'飞书应用的 App Secret',onChange:event=>setManualSecret(event.target.value),'aria-label':'App Secret'}),
                e('button',{type:'button',className:'dcb-bot-btn',disabled:accountBusy==='add',onClick:()=>{void applyManual();}},'添加并应用'),
                addScan.status==='error'?e('p',{className:'dcb-reg-msg dcb-reg-err'},addScan.message):null),
            e('div',{className:'dcb-bot-actions'},
              e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{stopAdd();setAddScan(null);}},'取消')))):null,
        e('ul',null,accounts.map(row=>e('li',{key:row.id,className:'dcb-account'},
          e('div',{className:row.id===selected?'dcb-account-main dcb-account-active':'dcb-account-main',onClick:()=>accountSelection.set(row.id),role:'button',tabIndex:0},
            e('strong',null,row.id),
            e('code',null,row.appIdMasked||'（无 App ID）'),
            e('span',null,row.workspacePath||'未设置工作区'),
            e('span',{className:row.connected?'dcb-ok':'dcb-todo'},row.connected?'● 已连接':(row.enabled?'○ 未连接':'○ 已关闭'))),
          e('div',{className:'dcb-bot-actions'},
            confirmDelete===row.id
              ?e(React.Fragment,null,
                e('span',{className:'dcb-reg-err'},'历史与凭证一并删除'),
                e('button',{type:'button',className:'dcb-bot-btn',disabled:accountBusy===row.id,onClick:()=>{void removeAccount(row.id);}},'确认删除'),
                e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>setConfirmDelete('')},'取消'))
              :e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>setConfirmDelete(row.id)},'删除'))))));
    };
    const accountPicker=()=>{
      const list=accounts??[];
      if(list.length<2)return null;
      return e('div',{className:'dcb-health dcb-workspace'},
        e('div',{className:'dcb-health-head'},
          e('strong',null,'编辑设置：'+(selected||'默认机器人')),
          e('select',{className:'dcb-bot-btn',value:selected,onChange:event=>accountSelection.set(event.target.value),'aria-label':'选择要编辑的机器人'},
            list.map(row=>e('option',{key:row.id,value:row.id},
              row.id+(row.appIdMasked?' · '+row.appIdMasked:'')+(row.connected?' · 已连接':''))))));
    };
    const head=(title,text)=>e('div',{className:'dcb-bot-head'},
      e('div',null,e('h3',null,title),e('p',null,text)));
    const noticeLine=()=>notice?e('p',{className:'dcb-reg-msg'},notice):null;
    // A scanned app only connects when the console side is configured; spell out
    // the exact switches instead of leaving the operator with "check permissions".
    // Hidden on a healthy connected page: there it is noise, not help.
    const channelMessage=String((snapshot?.details??{}).message??'');
    const needsHelp=!connected||/凭证校验失败|连接失败|连接超时|长连接/.test(channelMessage);
    const checklistBlock=()=>needsHelp?e('div',{className:'dcb-checklist'},
      e('div',{className:'dcb-checklist-head'},
        e('strong',null,'连接不上？按这 6 项检查飞书开发者后台'),
        e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>setChecklist(v=>!v)},checklist?'收起':'展开')),
      checklist?e('ol',null,
        e('li',null,'「应用能力 → 机器人」已开启；未开启时应用只能发消息，收不到任何事件。'),
        e('li',null,'「事件与回调 → 订阅方式」选择「长连接」（WebSocket），不要选 HTTP 回调。'),
        e('li',null,'订阅事件 im.message.receive_v1（接收消息）；要在群里用，再加 im.chat.bot.added_v1 与 im.chat.bot.deleted_v1。'),
        e('li',null,'权限至少包含：im:message、im:message:send_as_bot、im:chat；卡片相关：im:message 及卡片回传交互。'),
        e('li',null,'自建应用需要在「版本管理与发布」创建版本并发布，企业管理员审批通过后才生效；只保存不发布仍会连不上。'),
        e('li',null,'扫码时在手机上选择「已有机器人」会直接使用该应用的凭证，不需要先去后台重置密钥。')):null):null;
    // Auto-open on a connection failure so the checklist is visible exactly when
    // it is needed, still closable by hand.
    React.useEffect(()=>{
      if(/凭证校验失败|连接失败|连接超时|长连接/.test(channelMessage))setChecklist(true);
    },[channelMessage]);
    // Before the first snapshot arrives the panel would briefly claim "no bot
    // configured" and offer a QR, which is a confusing flash.
    if(snapshot?.status!=='ready'){
      return e('section',{className:'dcb-bot'},
        e('div',{className:'dcb-bot-head'},e('div',null,e('h3',null,'飞书机器人'),e('p',null,'正在读取渠道设置…'))));
    }
    // No bots at all: only the list (with its add button) and the hint make sense;
    // the workspace line and health checks describe a bot that does not exist yet.
    if(accounts&&accounts.length===0){
      return e('section',{className:'dcb-bot'},
        head('飞书机器人','还没有机器人。点「+ 添加机器人」：先为它选择独立的工作区，再用手机飞书扫码。'),
        accountsBlock(),
        noticeLine(),
        checklistBlock());
    }
    return e('section',{className:'dcb-bot'},
      head('飞书机器人','「+ 添加机器人」：先为它选择独立的工作区，再用手机飞书扫码。每个机器人独立工作区、独立会话，可以同时在线；不再需要时点该行的「删除」。'),
      accountPicker(),
      healthBlock(),
      accountsBlock(),
      noticeLine(),
      checklistBlock());
  }
  function AgentPresetHint({scope}) {
    const snapshot=useFileConfig(scope);
    const [catalog,setCatalog]=React.useState(null);
    React.useEffect(()=>{let alive=true;scope.call('presetCatalog',{}).then(value=>{if(alive&&value&&Array.isArray(value.presets))setCatalog(value);}).catch(()=>{});return()=>{alive=false};},[scope]);
    if(!catalog||!catalog.presets.length)return null;
    const ids=catalog.presets.map(row=>row.id);
    const current=String(snapshot?.value?.agentPreset??'').trim();
    // The picker already lists the choices; this line only speaks up when the
    // saved value cannot work, so it is never noise for a healthy config.
    if(!current||ids.includes(current))return null;
    return e('p',{className:'dcb-preset dcb-preset-warn'},
      e('span',null,'当前「Agent 预设 ID」为「'+current+'」，本机不存在，会自动回退到默认预设'+(catalog.default?'（'+catalog.default+'）':'')+'；请在下方重新选择或留空。'));
  }
  function ChannelConfigPanel({connection,credentialApi,kind}) {
    const page=bundledChannelPanels[kind];
    const rootScope=React.useMemo(()=>createConfigScope(connection,page.endpoint),[connection,kind]);
    React.useEffect(()=>()=>rootScope.close(),[rootScope]);
    // The form follows whichever bot account the panel above selected; Discord has
    // no account switcher, so it keeps its single scope.
    const selected=useSelectedAccount();
    const scope=React.useMemo(()=>kind==='feishu'&&selected?createAccountScope(rootScope,selected):rootScope,[rootScope,kind,selected]);
    React.useEffect(()=>{
      if(scope===rootScope)return undefined;
      void scope.reload().catch(()=>{});
      return ()=>scope.close();
    },[scope,rootScope]);
    // Feishu credentials live in the bot panel above, which is why the Feishu
    // page definition declares no appId / secret field and no credentialFields:
    // one entry per value, and the panel can write both in one action.
    const refs=page.credentialFields;
    const credentials=refs?value=>Object.fromEntries(Object.entries(refs).map(([key,label])=>[value[key],label])):undefined;
    return e(React.Fragment,null,
      kind==='feishu'?e(FeishuBotPanel,{scope:rootScope,credentialApi}):null,
      // With no bot selected (or no bots at all) the form has no account to edit;
      // rendering it against the whole file would save a v2 object as one slice.
      kind!=='feishu'||selected?e(AgentPresetHint,{scope}):null,
      // key: switching account remounts the form, so an unsaved draft can never be
      // saved onto the account that was just selected.
      kind!=='feishu'||selected?e(FileConfigPage,{...page,key:selected||'default',scope,credentialApi,credentials,credentialTitle:kind==='discord'?'Discord Bot Token':'飞书应用密钥',credentialsFirst:kind==='discord'}):null);
  }
  function ChannelBundlePage({connection,credentialApi,t}) {
    const [tab,setTab]=React.useState('general');
    const tabs=[['general','通用与会话'],['discord','Discord'],['feishu','飞书']];
    React.useEffect(()=>{
      const style=document.createElement('style');style.dataset.channelBundle='true';
      style.textContent=bundledConfigCss+botCss+regCss+'.dcb-tabs{display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap}.dcb-tabs button{padding:9px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:inherit;background:var(--dsw-alias-bg-layer-2);cursor:pointer}.dcb-tabs button[aria-selected=true]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:650}';
      document.head.appendChild(style);return()=>style.remove();
    },[]);
    return e('div',{className:'dcb-root'},
      e('div',{className:'dcb-tabs',role:'tablist','aria-label':'渠道设置'},
        ...tabs.map(([key,label])=>e('button',{key,type:'button',role:'tab','aria-selected':tab===key,tabIndex:tab===key?0:-1,onClick:()=>setTab(key)},label))),
      ...tabs.map(([key,label])=>e('section',{key,role:'tabpanel','aria-label':label,hidden:tab!==key},
        key==='general'?e(ConfigPage,{t,connection}):e(ChannelConfigPanel,{connection,credentialApi,kind:key}))));
  }
`;
const output=source.replace('/* CHANNEL_COMPONENTS_RENDERER */',helpers+'\n'+clientComponent);
if(output===source||!output.includes('ChannelBundlePage'))throw Error('template insertion failed');
const target=path.join(plugins,'lib/client.js');
fs.writeFileSync(target,output);
console.log('built '+target+' length '+output.length);
