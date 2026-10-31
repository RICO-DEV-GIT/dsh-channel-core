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
  const regCss='.dcb-reg{margin:0 0 22px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.dcb-reg-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.dcb-reg-head h3{margin:0 0 6px;font-size:15px}.dcb-reg-head p{margin:0;max-width:44em;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-reg-body{display:flex;gap:18px;align-items:center;margin-top:16px;flex-wrap:wrap}.dcb-reg-body img{border-radius:8px;background:#fff;flex:0 0 auto}.dcb-reg-msg{margin:12px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-reg-err{color:var(--dsw-alias-state-error-primary,#d64545)}.dcb-preset{margin:0 0 16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-preset code{color:inherit;font-size:12px}.dcb-preset-warn{border-color:var(--dsw-alias-state-error-primary,#d64545);color:var(--dsw-alias-state-error-primary,#d64545)}.dcb-bot-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}.dcb-checklist{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);font-size:12px;line-height:1.8;color:var(--dsw-alias-label-secondary,#8a8f99)}.dcb-checklist-head{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.dcb-checklist ol{margin:8px 0 0;padding-left:20px}.dcb-checklist li{margin:4px 0}';
  // One entry for the whole Feishu bot lifecycle: scan to create/connect,
  // paste existing credentials, then — once connected — scan to open the chat.
  // Two cards made the operator guess which QR to press; the state now decides.
  function FeishuBotPanel({scope,credentialApi}) {
    const snapshot=useFileConfig(scope);
    const config=snapshot?.value??{};
    const connected=(snapshot?.details??{}).connected===true;
    const appId=String(config.appId??'').trim();
    const secretRef=String(config.appSecretRef||'FEISHU_APP_SECRET');
    const [card,setCard]=React.useState({status:'idle',png:null,link:null,name:''});
    const [registration,setRegistration]=React.useState({status:'idle',qr:null,message:''});
    // Feedback that is not a form error (copy result, retry result) gets its own
    // slot instead of borrowing the credential form's message line.
    const [notice,setNotice]=React.useState('');
    const [checklist,setChecklist]=React.useState(false);
    const timer=React.useRef(null);
    // The device code has a lifetime; the caller stops polling at it instead of
    // spinning until the page reloads.
    const expireAt=React.useRef(0);
    // Feishu's own cadence: begin reports it, and slow_down raises it.
    const pollInterval=React.useRef(5);
    const pollCount=React.useRef(0);
    const pollFails=React.useRef(0);
    const stop=()=>{if(timer.current){clearTimeout(timer.current);timer.current=null;}};
    React.useEffect(()=>()=>stop(),[]);
    // One loader for the first render, the retry button and a credential change:
    // it used to call reload(), which refreshed the form but never asked for a
    // new card, so the panel sat on the loading text forever.
    const fetchCard=React.useCallback(async()=>{
      setCard({status:'loading',png:null,link:null,name:'',message:''});
      try{
        const value=await scope.call('botCard',{});
        setCard(value
          ?{status:'ready',png:value.png,link:value.link,name:value.name,message:''}
          :{status:'empty',png:null,link:null,name:'',message:'已连接，但暂未取到机器人身份；请确认应用已开启机器人能力后点「重新生成二维码」重试。'});
      }catch(error){
        setCard({status:'error',png:null,link:null,name:'',message:'二维码生成失败：'+(error?.message||'未知原因')});
      }
    },[scope]);
    React.useEffect(()=>{
      if(!connected){setCard({status:'idle',png:null,link:null,name:'',message:''});return;}
      // appId is a dependency too: replacing the bot while already connected can
      // complete faster than the page's poll observes connected=false, and the
      // QR would otherwise keep showing the previous bot.
      void fetchCard();
    },[connected,appId,fetchCard]);
    const copy=async()=>{
      try{await navigator.clipboard.writeText(card.link);setNotice('链接已复制');}
      catch{setNotice('复制失败，请手动选中链接复制');}
    };
    const poll=async deviceCode=>{
      let result;
      try{result=await scope.call('registrationPoll',{deviceCode});}
      catch(error){
        // A transient RPC/network failure is not a failed scan: Feishu keeps the
        // code valid, so retry a couple of times before giving up.
        if(pollFails.current<3&&Date.now()<expireAt.current){
          pollFails.current++;
          timer.current=setTimeout(()=>{void poll(deviceCode);},6000);
          return;
        }
        stop();setRegistration({status:'error',qr:null,message:(error.message||'轮询失败')+'；请重新生成二维码。'});return;
      }
      pollFails.current=0;
      if(result.status==='success'){
        stop();
        try{
          // Secret first, App ID second. Writing the config reconnects the
          // channel, and reconnecting with the NEW app id plus the OLD secret
          // is a guaranteed handshake failure that can stall on "正在连接".
          let secretSaved=false;
          if(result.appSecret&&credentialApi){const saved=await credentialApi.set(secretRef,result.appSecret);if(!saved.ok)throw new Error(saved.error?.message||'保存密钥失败');secretSaved=true;}
          // The openId may be absent (an existing app, or a tenant without user
          // info); send an empty string rather than dropping the field, which
          // the Host gateway reports as a signature mismatch.
          const applied=await scope.call('registrationApply',{appId:result.appId,openId:result.openId||'',domain:result.domain||''});
          const ref=applied&&applied.value&&applied.value.appSecretRef?applied.value.appSecretRef:secretRef;
          await scope.reload();
          const parts=['已写入 App ID '+(result.appId||'')];
          if(result.domain==='lark')parts.push('区域 Lark');
          if(result.openId)parts.push('主人 '+result.openId);
          if(secretSaved)parts.push('密钥已保存');
          setRegistration({status:'done',qr:null,message:parts.join(' · ')+'。'});
        }catch(error){
          setRegistration({status:'error',qr:null,message:'自动写入失败：'+error.message+'。请点「重新生成二维码」再扫码一次。'});
        }
        return;
      }
      if(result.status==='pending'){
        // Stop at the code's own lifetime: polling forever left the card stuck on
        // "等待扫码…" with the generate button disabled, so nothing could recover
        // it without reloading the page.
        if(Date.now()>expireAt.current){stop();setRegistration({status:'error',qr:null,message:'二维码已过期，请重新生成。'});return;}
        // Feishu answers 400 slow_down when polled faster than its own interval;
        // honour the interval from begin (5s) and back off further when asked.
        const base=Math.max(5,pollInterval.current);
        const wait=result.slowDown?Math.min(30,base+5):base;
        pollInterval.current=wait;
        pollCount.current++;
        // After a while the only useful advice is: confirm on the phone, then
        // regenerate and follow the checklist — there is no manual form anymore.
        const hint=pollCount.current>=6?'　请在手机上完成确认；若已确认仍无响应，点「重新生成二维码」并按下方清单检查应用配置。':'';
        setRegistration(current=>({...current,message:current.message.split('　如果手机上选的是')[0]+hint}));
        timer.current=setTimeout(()=>{void poll(deviceCode);},wait*1000);return;
      }
      stop();
      const hint=result.status==='access_denied'?'未授权，流程已取消。'
        :result.status==='expired'?'二维码已过期，请重新生成。'
        :('飞书返回错误：'+(result.message||result.error||'未知原因'));
      setRegistration({status:'error',qr:null,message:hint});
    };
    const begin=async()=>{
      if(registration.status==='waiting')return;
      setRegistration({status:'begin',qr:null,message:''});
      try{
        const value=await scope.call('registrationBegin',{});
        expireAt.current=Date.now()+(Number(value.expireSeconds)||600)*1000;
        // Poll at the interval Feishu asked for; faster answers are rejected with
        // slow_down and the scan then looks stuck even though it is working.
        pollInterval.current=Math.max(5,Number(value.intervalSeconds)||5);
        pollCount.current=0;pollFails.current=0;
        setRegistration({status:'waiting',qr:value.qrPng,message:'用手机飞书扫码：还没有机器人就选「新建应用」（自动写入）；已有就选「已有应用」，把手机上的 App ID 与密钥填到下方。二维码约 '+(value.expireSeconds||600)+' 秒有效。'});
        timer.current=setTimeout(()=>{void poll(value.deviceCode);},pollInterval.current*1000);
      }catch(error){setRegistration({status:'error',qr:null,message:error.message||'生成二维码失败'});}
    };
    const head=(title,text)=>e('div',{className:'dcb-bot-head'},
      e('div',null,e('h3',null,title),e('p',null,text)));
    const registrationMessage=()=>registration.message
      ?e('p',{className:'dcb-reg-msg'+(registration.status==='error'?' dcb-reg-err':''),role:registration.status==='error'?'alert':undefined},registration.message)
      :null;
    // ONE action owns the whole lifecycle: scan, then choose "new bot" or an
    // existing one on the phone. Feishu returns the id and the secret for both,
    // so nothing has to be pasted here — and because it stays available while
    // connected, switching bots never needs a console reset first.
    const scanBlock=()=>e(React.Fragment,null,
      e('div',{className:'dcb-bot-actions'},
        e('button',{type:'button',className:'dcb-bot-btn',onClick:begin,disabled:registration.status==='waiting'||registration.status==='begin'},
          registration.status==='waiting'?'等待手机确认…':(registration.qr?'重新生成二维码':'扫码添加 / 切换机器人'))),
      registration.qr?e('div',{className:'dcb-reg-body'},
        e('img',{src:registration.qr,alt:'飞书扫码二维码',width:220,height:220}),
        e('div',{className:'dcb-bot-meta'},
          e('strong',null,'手机飞书扫码'),
          e('p',{className:'dcb-bot-link'},'在手机上选择「新建机器人」或「已有机器人」，确认后这里会自动写入 App ID、密钥和主人身份。'))):null,
      registrationMessage());
    const noticeLine=()=>notice?e('p',{className:'dcb-reg-msg'},notice):null;
    // A scanned app only connects when the console side is configured; spell out
    // the exact switches instead of leaving the operator with "check permissions".
    const checklistBlock=()=>e('div',{className:'dcb-checklist'},
      e('div',{className:'dcb-checklist-head'},
        e('strong',null,'连接不上？按这 6 项检查飞书开发者后台'),
        e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>setChecklist(v=>!v)},checklist?'收起':'展开')),
      checklist?e('ol',null,
        e('li',null,'「应用能力 → 机器人」已开启；未开启时应用只能发消息，收不到任何事件。'),
        e('li',null,'「事件与回调 → 订阅方式」选择「长连接」（WebSocket），不要选 HTTP 回调。'),
        e('li',null,'订阅事件 im.message.receive_v1（接收消息）；要在群里用，再加 im.chat.bot.added_v1 与 im.chat.bot.deleted_v1。'),
        e('li',null,'权限至少包含：im:message、im:message:send_as_bot、im:chat；卡片相关：im:message 及卡片回传交互。'),
        e('li',null,'自建应用需要在「版本管理与发布」创建版本并发布，企业管理员审批通过后才生效；只保存不发布仍会连不上。'),
        e('li',null,'扫码时在手机上选择「已有机器人」会直接使用该应用的凭证，不需要先去后台重置密钥。')):null);
    // Auto-open on a connection failure so the checklist is visible exactly when
    // it is needed, still closable by hand.
    const channelMessage=String((snapshot?.details??{}).message??'');
    React.useEffect(()=>{
      if(/凭证校验失败|连接失败|连接超时|长连接/.test(channelMessage))setChecklist(true);
    },[channelMessage]);
    // Before the first snapshot arrives the panel would briefly claim "no bot
    // configured" and offer a QR, which is a confusing flash.
    if(snapshot?.status!=='ready'){
      return e('section',{className:'dcb-bot'},
        e('div',{className:'dcb-bot-head'},e('div',null,e('h3',null,'飞书机器人'),e('p',null,'正在读取渠道设置…'))));
    }
    if(!connected){
      return e('section',{className:'dcb-bot'},
        head('连接飞书机器人','用手机飞书扫描下面的二维码：在手机上选择「新建机器人」会自动创建并写入凭证，选择「已有机器人」会直接拉取该应用的 App ID 与密钥。全程不用手填，也不用先去开发者后台重置凭证。'),
        scanBlock(),
        noticeLine(),
        checklistBlock());
    }
    return e('section',{className:'dcb-bot'},
      head('机器人已连接',(card.name||'机器人')+'：用手机飞书扫描下面的二维码即可打开与它的私聊，发送任意消息后按「主人与记忆」的规则完成认领。二维码只包含机器人公开 open_id，不含任何密钥。'),
      registration.qr?null
        :card.png?e('div',{className:'dcb-bot-body'},
        e('img',{src:card.png,alt:'飞书机器人二维码',width:220,height:220}),
        e('div',{className:'dcb-bot-meta'},
          e('strong',null,card.name||'飞书机器人'),
          e('code',{className:'dcb-bot-link'},card.link),
          e('div',{className:'dcb-bot-actions'},
            e('button',{type:'button',className:'dcb-bot-copy',onClick:copy},'复制链接'))))
        :e(React.Fragment,null,
          e('p',{className:'dcb-bot-msg'+(card.status==='error'?' dcb-reg-err':''),role:card.status==='error'?'alert':undefined},card.message||'正在生成二维码…'),
          e('div',{className:'dcb-bot-actions'},
            e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{void fetchCard();}},'重新生成二维码'))),
      // Still available when connected: scanning again is how a different bot is
      // added or switched to, chosen entirely on the phone.
      scanBlock(),
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
    const scope=React.useMemo(()=>createConfigScope(connection,page.endpoint),[connection,kind]);
    React.useEffect(()=>()=>scope.close(),[scope]);
    // Feishu credentials live in the bot panel above, which is why the Feishu
    // page definition declares no appId / secret field and no credentialFields:
    // one entry per value, and the panel can write both in one action.
    const refs=page.credentialFields;
    const credentials=refs?value=>Object.fromEntries(Object.entries(refs).map(([key,label])=>[value[key],label])):undefined;
    return e(React.Fragment,null,
      kind==='feishu'?e(FeishuBotPanel,{scope,credentialApi}):null,
      e(AgentPresetHint,{scope}),
      e(FileConfigPage,{...page,scope,credentialApi,credentials,credentialTitle:kind==='discord'?'Discord Bot Token':'飞书应用密钥',credentialsFirst:kind==='discord'}));
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
