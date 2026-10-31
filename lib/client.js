window.__ModuleLoader__.load({
  id: 'dsh-channel-core',
  factory(require) {
    const React = require('react');
    const { Switch, Button } = require('@deepseek-ai/dsh-client-ui-primitives');
    const e = React.createElement;
    // Embedded by build.mjs. React and the official Connection are provided by DSH.
const { Switch: DshSwitch, Button: DshButton } = require('@deepseek-ai/dsh-client-ui-primitives');
function createConfigScope(connection, endpoint) {
  let state = { status: 'loading', writable: connection.isLoopback !== false }, closed = false, serial = 0, saving = false;
  const listeners = new Set(), requests = new Set();
  const publish = next => { if (!closed) { state = next; for (const fn of listeners) fn(); } };
  const call = async (method, args) => {
    if (closed) throw new Error('插件已停用');
    const abort = new AbortController(); requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const result = await connection.rpc.call('/api', endpoint + '/' + method, { args }, abort.signal);
      if (!result.ok) throw Object.assign(new Error(result.error?.message || result.error?.code || '请求失败'), { code: result.error?.code });
      return result.value;
    } finally { clearTimeout(timeout); requests.delete(abort); }
  };
  const accept = value => publish({ ...value, status: 'ready', writable: connection.isLoopback !== false, requestError: '' });
  const scope = {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async reload() {
      const sequence = ++serial;
      try { const value = await call('getConfig', {}); if (sequence === serial) accept(value); return value; }
      catch (error) { if (sequence === serial) publish({ ...state, requestError: error.message }); throw error; }
    },
    async update(value, revision = state.revision) {
      if (saving) throw new Error('正在保存，请稍候');
      saving = true; ++serial;
      try { const result = await call('setConfig', { value, revision }); accept(result); return result; }
      finally { saving = false; }
    },
    set(key, value) { return scope.update({ ...state.value, [key]: value }); },
    call,
    async runAction() { const result = await call('runAction', {}); accept(result); return result; },
    close() { closed = true; ++serial; for (const abort of requests) abort.abort(); listeners.clear(); },
  };
  return scope;
}
function useFileConfig(scope) {
  return React.useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot);
}
const configValue=(value,key)=>key.split('.').reduce((current,part)=>current?.[part],value);
const configChange=(value,key,next)=>{
  const [head,...tail]=key.split('.');
  return {...value,[head]:tail.length?configChange(value[head],tail.join('.'),next):next};
};
function ModelPicker({ scope, kind='chat', provider, model, disabled, label, emptyLabel, onChange }) {
  const e=React.createElement, [catalog,setCatalog]=React.useState({groups:[]}), [error,setError]=React.useState('');
  React.useEffect(()=>{
    let active=true,sequence=0;
    const load=()=>{const current=++sequence;scope.call('modelCatalog',{kind}).then(value=>{if(active&&current===sequence){setCatalog(value);setError('');}}).catch(failure=>{if(active&&current===sequence)setError(failure.message);});};
    load();window.addEventListener('focus',load);return()=>{active=false;window.removeEventListener('focus',load);};
  },[scope,kind]);
  const encode=(provider,model)=>JSON.stringify([provider,model]),value=encode(provider||'',model||'');
  const known=catalog.groups.some(group=>group.models.some(entry=>group.id===provider&&entry.id===model));
  return e('div',null,e('select',{'aria-label':label,value,disabled,onChange:event=>{const [provider,model]=JSON.parse(event.target.value);onChange({provider,model});}},
    e('option',{value:encode('','')},emptyLabel || (kind==='embedding'?'词语检索（不使用向量模型）':'继承 DSH 默认模型')),
    provider&&model&&!known?e('option',{value},`${provider} / ${model}（当前配置）`):null,
    catalog.groups.map(group=>e('optgroup',{key:group.id,label:group.name||group.id},group.models.map(entry=>e('option',{key:entry.id,value:encode(group.id,entry.id)},entry.name||entry.id))))),
    error?e('small',{role:'status'},'模型目录暂不可用：'+error):kind==='embedding'&&!catalog.groups.length?e('small',null,'尚未注册向量模型。'):null);
}
function RolePicker({scope,value,disabled,label,onChange}) {
  const e=React.createElement,[catalog,setCatalog]=React.useState({available:false,roles:[]}),[error,setError]=React.useState('');
  React.useEffect(()=>{
    let active=true,sequence=0;
    const load=()=>{const current=++sequence;scope.call('roleCatalog',{}).then(result=>{if(active&&current===sequence){setCatalog(result);setError('');}}).catch(failure=>{if(active&&current===sequence)setError(failure.message);});};
    load();window.addEventListener('focus',load);
    return()=>{active=false;window.removeEventListener('focus',load);};
  },[scope]);
  const known=catalog.roles.some(role=>role.preset===value);
  return e('div',null,e('select',{'aria-label':label,value,disabled,onChange:event=>onChange(event.target.value)},
    e('option',{value:''},'自动关联预设与工作区（兼容原配置）'),
    value&&!known?e('option',{value},value+'（当前角色不可用）'):null,
    catalog.roles.map(role=>e('option',{key:role.preset,value:role.preset},role.name+' · '+(role.workspaceTitle||role.preset)))),
    error?e('small',{role:'status'},'角色目录读取失败：'+error):!catalog.available?e('small',null,'指令文件与角色插件不可用；原路径配置仍可使用。'):null);
}
function PresetPicker({scope,value,disabled,label,onChange}) {
  const e=React.createElement,[catalog,setCatalog]=React.useState(null),[error,setError]=React.useState('');
  React.useEffect(()=>{
    let active=true,sequence=0;
    const load=()=>{const current=++sequence;scope.call('presetCatalog',{}).then(result=>{
      if(!active||current!==sequence)return;
      const presets=Array.isArray(result?.presets)?result.presets:[];
      setCatalog({presets,default:String(result?.default??'')});setError('');
    }).catch(failure=>{if(active&&current===sequence)setError(failure.message);});};
    load();window.addEventListener('focus',load);
    return()=>{active=false;window.removeEventListener('focus',load);};
  },[scope]);
  // A Host without the preset registry keeps the plain text field: an operator
  // may still be running a deployment that names presets itself.
  if(!catalog)return e('div',null,e('input',{id:'dsh-config-agentPreset','aria-label':label,type:'text',value,disabled,onChange:event=>onChange(event.target.value)}),
    error?e('small',{role:'status'},'预设目录读取失败，可手动填写：'+error):e('small',null,'正在读取本机可用预设…'));
  const known=catalog.presets.some(row=>row.id===value);
  const autoLabel=catalog.default?'留空（跟随默认：'+catalog.default+'）':'留空（跟随宿主默认预设）';
  return e('div',null,e('select',{id:'dsh-config-agentPreset','aria-label':label,value,disabled,onChange:event=>onChange(event.target.value)},
    e('option',{value:''},autoLabel),
    value&&!known?e('option',{value},value+'（本机不存在，会自动回退默认）'):null,
    catalog.presets.map(row=>e('option',{key:row.id,value:row.id},row.name&&row.name!==row.id?row.name+' · '+row.id:row.id)),
  ),e('small',null,catalog.presets.length?'可选：'+catalog.presets.map(row=>row.id).join(' · '):'宿主未提供预设列表，可手动填写预设 ID。'));
}
function FileConfigPage({ scope, title, description, fields, actionLabel, credentialApi, credentials, credentialTitle='凭证', credentialsFirst=false }) {
  const e = React.createElement, snapshot = useFileConfig(scope);
  const [editor, setEditor] = React.useState({ base: null, draft: null, error: '', saved: false });
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false), alive = React.useRef(false);
  const dirty = !!editor.base && JSON.stringify(editor.draft) !== JSON.stringify(editor.base.value);
  const external = !!editor.base && snapshot.revision !== editor.base.revision;
  React.useEffect(() => {
    if (snapshot.status !== 'ready') return;
    setEditor(previous => !previous.base || (!busyRef.current && JSON.stringify(previous.draft) === JSON.stringify(previous.base.value))
      ? { base: snapshot, draft: structuredClone(snapshot.value), error: '', saved: previous.saved } : previous);
  }, [snapshot]);
  React.useEffect(() => {
    alive.current = true;
    let reloading = false;
    const reload = () => {
      if (busyRef.current || reloading) return;
      reloading = true;
      void scope.reload().catch(() => {}).finally(() => { reloading = false; });
    };
    reload(); window.addEventListener('focus', reload);
    const interval = actionLabel ? setInterval(() => { if (document.visibilityState !== 'hidden') reload(); }, 2000) : null;
    return () => { alive.current = false; window.removeEventListener('focus', reload); if (interval) clearInterval(interval); };
  }, [scope, actionLabel]);
  const work = async operation => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await operation(); }
    catch (error) { if (alive.current) setEditor(previous => ({ ...previous, error: error.message, errorCode: error.code, saved: false })); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const replace = result => { if (alive.current) setEditor({ base: result, draft: structuredClone(result.value), error: '', saved: false }); };
  const change = (key, value) => setEditor(previous => ({ ...previous, draft: configChange(previous.draft,key,value), error: '', errorCode: '', saved: false }));
  const disabled = busy || !snapshot.writable || !editor.draft;
  const field = spec => {
    const value = configValue(editor.draft,spec.key), id = 'dsh-config-' + spec.key;
    const common = { id, disabled: disabled || spec.disabled, 'aria-label': spec.label };
    let input;
    if (spec.type === 'credential') return e('div',{className:'dpc-field dpc-credential',key:spec.key},
      e('div',{className:'dpc-label'},e('span',null,spec.label),e('small',null,'独立保存到 DSH 凭证管理，不会写入渠道配置文件。')),
      e('div',{className:'dpc-control'},credentialApi&&credentials&&snapshot.value
        ?e(CredentialsPage,{api:credentialApi,refs:credentials(snapshot.value),writable:snapshot.writable,title:spec.label,inline:true})
        :e('small',null,'凭证服务暂不可用')));
    if (spec.type === 'readonly') input = e('div', { className: 'dpc-status', id }, snapshot.details?.[spec.detail] ?? spec.placeholder ?? '—');
    else if (spec.type === 'boolean') input = e(DshSwitch, { label: spec.label, disabled: common.disabled, checked: value, onChange: next => change(spec.key, next) });
    else if (spec.type === 'multiline') {
      const editor=e('textarea', {...common,rows:5,value,onChange:event=>change(spec.key,event.target.value)});
      input=spec.defaultValue===undefined?editor:e('div',{className:'dpc-prompt-editor'},editor,
        e(DshButton,{type:'button',variant:'ghost',size:'sm',disabled:common.disabled||value===spec.defaultValue,
          onClick:()=>change(spec.key,spec.defaultValue)},'恢复默认'));
    }
    else if (spec.type === 'list') input = e('textarea', {...common, rows: Math.max(3,Math.min(8,value.length+1)), value:editor.listText?.[spec.key]??value.join('\n'),
      onChange:event=>{const text=event.target.value;setEditor(previous=>({...previous,draft:configChange(previous.draft,spec.key,text.split(/[\n,]/).map(item=>item.trim()).filter(Boolean)),listText:{...previous.listText,[spec.key]:text},error:'',errorCode:'',saved:false}));} });
    else if (spec.type === 'role') input = e(RolePicker,{scope,value,disabled:common.disabled,label:spec.label,onChange:next=>change(spec.key,next)});
    else if (spec.type === 'preset') input = e(PresetPicker,{scope,value,disabled:common.disabled,label:spec.label,onChange:next=>change(spec.key,next)});
    else if (spec.type === 'model') input = e(ModelPicker,{scope,kind:spec.kind,provider:configValue(editor.draft,spec.providerKey),model:value,emptyLabel:spec.emptyLabel,disabled:common.disabled,label:spec.label,onChange:selection=>setEditor(previous=>({...previous,draft:configChange(configChange(previous.draft,spec.providerKey,selection.provider),spec.key,selection.model),error:'',errorCode:'',saved:false}))});
    else if (spec.type === 'select') input = e('select', { ...common, value, onChange: event => change(spec.key, spec.numeric ? Number(event.target.value) : event.target.value) }, spec.options.map(([key, label]) => e('option', { key, value: key }, label)));
    else if (spec.type === 'order' || spec.type === 'providers') input = e('ol', { className: 'dpc-order' }, value.map((key, index) => e('li', { key },
      e('span', { className: 'dpc-rank', 'aria-hidden': true }, index + 1), e('span', { className: 'dpc-provider-name' }, spec.labels[key] || key),
      spec.type === 'providers' ? e(DshSwitch, { label: '启用 ' + (spec.labels[key] || key), checked: editor.draft.enabledProviders.includes(key), disabled,
        onChange: next => change('enabledProviders', next ? [...editor.draft.enabledProviders, key] : editor.draft.enabledProviders.filter(item => item !== key)) }) : null,
      e('div', { className: 'dpc-order-actions' }, ...[-1, 1].map(delta => e(DshButton, {
        key: delta, type: 'button', disabled: disabled || index + delta < 0 || index + delta >= value.length,
        variant: 'ghost', size: 'sm', className: 'dpc-arrow', title: delta < 0 ? '上移' : '下移',
        'aria-label': (delta < 0 ? '上移 ' : '下移 ') + (spec.labels[key] || key),
        onClick: () => { const next = [...value]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; change(spec.key, next); },
      }, e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        e('path', { d: delta < 0 ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6' }))))))));
    else if (spec.type === 'choices') input = e('div', null, Object.entries(spec.labels).map(([key, label]) => e('label', { className: 'dpc-choice', key }, e('input', {
      type: 'checkbox', checked: value.includes(key), disabled, onChange: event => change(spec.key, event.target.checked ? [...value, key] : value.filter(x => x !== key)),
    }), ' ', label)));
    else input = e('input', { ...common, type: spec.type === 'number' ? 'number' : 'text', value,
      min: spec.min, max: spec.max, step: spec.step ?? 1,
      onChange: event => change(spec.key, spec.type === 'number' ? Number(event.target.value) : event.target.value),
    });
    return e('div', { className: 'dpc-field dpc-' + spec.type, key: spec.key },
      e('div', { className: 'dpc-label' }, e('label', { htmlFor: spec.type === 'boolean' ? undefined : id }, spec.label), spec.help ? e('small', null, spec.help) : null, spec.emptyHelp&&Array.isArray(value)&&!value.length?e('small',null,spec.emptyHelp):null),
      e('div', { className: 'dpc-control' }, input));
  };
  const visible=spec=>!spec.when||(Array.isArray(spec.when)?spec.when:[spec.when]).some(condition=>Object.entries(condition).every(([key,value])=>configValue(editor.draft,key)===value));
  const grouped=advanced=>{
    const groups=[];
    for(const spec of fields.filter(spec=>!!spec.advanced===advanced&&visible(spec))){
      if(!groups.length||groups.at(-1).title!==(spec.group||''))groups.push({title:spec.group||'',fields:[]});
      groups.at(-1).fields.push(spec);
    }
    const items=specs=>{
      const result=[];
      for(let index=0;index<specs.length;){
        const spec=specs[index];
        if(!spec.fold){result.push(field(spec));index++;continue;}
        let end=index+1;
        while(end<specs.length&&specs[end].fold===spec.fold)end++;
        result.push(e('details',{className:'dpc-fold',key:'fold-'+spec.key},
          e('summary',null,spec.fold),...specs.slice(index,end).map(field)));
        index=end;
      }
      return result;
    };
    return groups.map((group,index)=>e('section',{className:'dpc-group',key:index},group.title?e('h4',null,group.title):null,items(group.fields)));
  };
  const embeddedCredentials=fields.some(spec=>spec.type==='credential');
  const credentialView=!embeddedCredentials&&credentialApi&&credentials&&snapshot.value?e(CredentialsPage,{api:credentialApi,refs:credentials(snapshot.value),writable:snapshot.writable,title:credentialTitle,expanded:credentialsFirst}):null;
  const reloadNeeded = external || snapshot.requestError || editor.errorCode?.includes('conflict');
  return e('form', { className: 'dpc-page', 'aria-label': title, onSubmit: event => { event.preventDefault(); if (disabled || external || (!dirty && !snapshot.error)) return;
    void work(async () => { const result = await scope.update(editor.draft, editor.base.revision); replace(result); if (alive.current) setEditor(previous => ({ ...previous, saved: true })); });
  } },credentialsFirst?credentialView:null,editor.draft?grouped(false):e('p',null,'正在读取配置…'),
    editor.draft&&fields.some(spec=>spec.advanced&&visible(spec))?e('details',{className:'dpc-advanced'},e('summary',null,'高级设置'),grouped(true)):null,
    snapshot.error ? e('p', { role: 'alert' }, '文件有误，运行时保留上一次有效设置。', snapshot.error.message, '；保存可修复文件。') : null,
    external ? e('p', { role: 'alert' }, '配置已被其他页面或文件编辑修改。重新载入后再保存，可避免覆盖外部修改。') : null,
    editor.error || snapshot.requestError ? e('p', { role: 'alert' }, editor.error || snapshot.requestError) : null,
    e('div', { className: 'dpc-actions' }, e(DshButton, { type: 'submit', variant: 'primary', disabled: disabled || external || (!dirty && !snapshot.error) }, busy ? '处理中…' : '保存'),
      reloadNeeded ? e(DshButton, { type: 'button', variant: 'outline', disabled: busy, onClick: () => void work(async () => replace(await scope.reload())) }, dirty ? '放弃草稿并重新载入' : '重新载入') : null,
      actionLabel ? e(DshButton, { type: 'button', variant: 'outline', disabled: busy || !snapshot.writable, onClick: () => void work(async () => { await scope.runAction(); }) }, actionLabel) : null,
      e('span', { role: 'status' }, editor.saved ? '已保存并生效' : dirty ? '尚未保存' : '')),
    snapshot.details ? e('p', { role: 'status' }, snapshot.details.message) : null,
    e('p', { className: 'dpc-note' }, '保存后自动应用，后续操作使用新配置。'),
    snapshot.configFile ? e('details', { className: 'dpc-path' }, e('summary', null, '配置文件'), e('code', null, snapshot.configFile)) : null,
    credentialsFirst?null:credentialView,
  );
}
function CredentialsPage({ api, refs, writable, title, expanded=false, inline=false }) {
  const e = React.createElement;
  const [status, setStatus] = React.useState({}), [drafts, setDrafts] = React.useState({}), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const alive = React.useRef(false), running = React.useRef(false);
  const identity = JSON.stringify(refs);
  React.useEffect(() => {
    let active = true;
    alive.current = true;
    void api.describe(Object.keys(refs)).then(result => {
      if (!active) return;
      if (!result.ok) throw new Error(result.error?.message || '读取凭证状态失败');
      setStatus(result.value);
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; alive.current = false; };
  }, [api, identity]);
  const save = async (ref, clear) => {
    if (running.current || !writable) return; running.current = true; setBusy(true); setError('');
    try {
      const result = clear ? await api.unset(ref) : await api.set(ref, drafts[ref]);
      if (!result.ok) throw new Error(result.error?.message || '保存凭证失败');
      if (!alive.current) return;
      setDrafts(previous => ({ ...previous, [ref]: '' }));
      setStatus(previous => ({ ...previous, [ref]: { configured: !clear } }));
    } catch (reason) { if (alive.current) setError(reason.message); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  return e(inline?'div':expanded?'section':'details', { className: inline?'dpc-credentials-inline':'dpc-credentials' },
    inline?null:e(expanded?'h4':'summary', null, title), e('fieldset', { disabled: busy || !writable },
    inline?null:e('p', null, '密钥单独保存到 DSH 凭证管理；已有密钥只显示配置状态。'),
    Object.entries(refs).map(([ref, label]) => e('div', { className: inline?'dpc-inline-secret':'dpc-field', key: ref },
      inline?e('small',{role:'status'},status[ref]?.configured?'密钥已配置':'密钥未配置'):e('label', null, label, ' · ', ref),
      e('input', { type: 'password', autoComplete: 'new-password', 'aria-label': label + ' 密钥', value: drafts[ref] || '', placeholder: status[ref]?.configured ? '已配置；留空保持' : '未配置',
        onChange: event => setDrafts(previous => ({ ...previous, [ref]: event.target.value })) }),
      e('div', { className: 'dpc-actions' }, e(DshButton, { type: 'button', variant: 'outline', disabled: !drafts[ref], onClick: () => void save(ref, false) }, '保存密钥'),
        e(DshButton, { type: 'button', variant: 'ghost', disabled: !status[ref]?.configured, onClick: () => void save(ref, true) }, '清除密钥')))),
    error ? e('p', { role: 'alert' }, error) : null));
}

const bundledChannelPanels={"discord":{"rowId":"channel-discord","endpoint":"discordChannelSettings","title":"Discord 渠道","description":"将 Discord 消息接入 DSH 原生会话，支持线程、交互和渠道设置。","standalone":true,"actionLabel":"重新连接","credentialFields":{"tokenRef":"Discord Bot Token"},"fields":[{"key":"enabled","label":"连接渠道","type":"boolean","help":"保存后自动连接；有效凭证用于登录，消息接收范围单独配置。","group":"账号与连接","advanced":false},{"key":"applicationId","type":"readonly","label":"应用 ID","detail":"applicationId","placeholder":"连接后自动识别","help":"登录成功后自动读取 Discord 的应用 ID。","group":"账号与连接","advanced":false},{"key":"credentialSecret","label":"Discord Bot Token","type":"credential","group":"账号与连接","advanced":false},{"key":"accountId","label":"账号标识","type":"text","help":"本地用于区分机器人账号，配置后保持稳定。","group":"账号与连接","advanced":false,"fold":"更多连接设置"},{"key":"tokenRef","label":"凭证名称","type":"text","help":"Bot Token 在上方机器人凭证区保存。","group":"账号与连接","advanced":false,"fold":"更多连接设置"},{"key":"dmPolicy","group":"接收与权限","label":"私聊接收范围","type":"select","options":[["disabled","关闭私聊"],["allowlist","仅指定用户"],["all","所有私聊用户"]],"help":"与服务器范围分别设置；选择所有私聊用户后无需填写用户 ID，各用户的私聊会话独立。","advanced":false},{"key":"allowedUsers","group":"接收与权限","label":"允许使用的用户 ID","type":"list","help":"私聊选择指定用户、服务器选择指定范围时使用，每行一个；选择全部范围时无需填写。","when":[{"dmPolicy":"allowlist"},{"allowGroups":true,"groupPolicy":"allowlist"}],"emptyHelp":"指定用户模式需要填写用户 ID，空列表暂不接收消息。","advanced":false},{"key":"allowGroups","group":"接收与权限","label":"接收服务器消息","type":"boolean","advanced":false},{"key":"groupPolicy","group":"接收与权限","label":"服务器接收范围","type":"select","options":[["allowlist","指定允许的用户和频道"],["all","服务器内所有用户、所有频道"]],"help":"只应用于服务器消息；私聊由私聊接收范围单独设置。","when":{"allowGroups":true},"advanced":false},{"key":"allowedGroups","group":"接收与权限","label":"允许的频道 ID","type":"list","help":"指定范围时使用，每行一个频道 ID；选择全部范围时无需填写。","when":{"allowGroups":true,"groupPolicy":"allowlist"},"emptyHelp":"指定频道模式需要填写频道 ID，空列表暂不接收服务器消息。","advanced":false},{"key":"requireMention","group":"接收与权限","label":"服务器消息需要 @ 机器人","type":"boolean","when":{"allowGroups":true},"advanced":false},{"key":"rolePreset","group":"会话与输入","label":"使用角色","type":"role","help":"从「指令文件与角色」选择角色，渠道新会话自动进入对应工作区。","advanced":false},{"key":"inputMode","group":"会话与输入","label":"新消息输入方式","type":"select","options":[["inherit","跟随“渠道与会话”设置"],["steering","Steering：加入当前任务"],["queue","Queue：排入后续轮次"],["interrupt","Interrupt：停止当前轮次并接收新输入"]],"advanced":false},{"key":"registerCommands","label":"注册 /dsh 指令","group":"会话与输入","type":"boolean","help":"连接后自动添加 /dsh；保留该机器人已有的其他指令。","advanced":false,"fold":"更多会话设置"},{"key":"agentPreset","group":"会话与输入","label":"Agent 预设 ID","type":"preset","help":"从本机已注册的预设中选择；留空跟随宿主默认预设。","advanced":false,"when":{"rolePreset":""},"fold":"更多会话设置"},{"key":"workspacePath","group":"会话与输入","label":"工作区路径","type":"text","help":"未选择角色时生效。留空跟随客户端已登记的默认工作区；填写后使用指定目录。","advanced":false,"when":{"rolePreset":""},"fold":"更多会话设置"},{"key":"resolvedWorkspace","label":"实际工作区","type":"readonly","detail":"workspacePath","placeholder":"渠道连接后显示","group":"会话与输入","advanced":false,"help":"显示渠道新会话实际使用的目录。","fold":"更多会话设置"},{"key":"streaming.mode","group":"回复与显示","label":"回复显示方式","type":"select","options":[["progress","执行进度（progress）"],["partial","实时正文（partial）"],["off","仅最终回复（off）"]],"help":"进度模式交替滚动显示草稿和工具；Discord 完成后仅保留正文，飞书完成后分别显示折叠草稿卡和独立正文卡。","advanced":false},{"key":"displayIcon","group":"回复与显示","label":"Agent 图标","type":"text","placeholder":"🐋","help":"Discord 进度及提问消息头的自定义图标，默认 🐋。推荐单个 Emoji 或组合 Emoji。","advanced":false},{"key":"streaming.footer.status","group":"回复与显示","label":"显示状态","type":"boolean","advanced":false,"fold":"更多显示设置","help":"在底部显示任务完成、失败或停止状态。"},{"key":"streaming.footer.elapsed","group":"回复与显示","label":"显示任务耗时","type":"boolean","advanced":false,"fold":"更多显示设置","help":"从本次原生 Turn 开始计时，显示完成耗时。"},{"key":"streaming.footer.model","group":"回复与显示","label":"显示模型名称","type":"boolean","advanced":false,"fold":"更多显示设置","help":"默认开启；从当前 Session 的模型选择读取，读不到时隐藏。"},{"key":"streaming.footer.context","group":"回复与显示","label":"显示上下文用量","type":"boolean","advanced":false,"fold":"更多显示设置","help":"默认开启；从 DSH 原生 Token Meter 读取已占用 Token。没有可信值时不显示。"},{"key":"streaming.footer.tokens","group":"回复与显示","label":"显示输入／输出 Token","type":"boolean","advanced":false,"fold":"更多显示设置","help":"默认关闭；仅在原生运行指标可用时显示。"},{"key":"streaming.footer.cache","group":"回复与显示","label":"显示缓存用量","type":"boolean","advanced":false,"fold":"更多显示设置","help":"默认关闭；仅在原生运行指标可用时显示。"},{"key":"streaming.progress.toolProgress","label":"显示工具进度","type":"boolean","group":"回复与显示","advanced":false,"when":{"streaming.mode":"progress"}},{"key":"streaming.progress.commentary","label":"显示简短执行说明","type":"boolean","group":"回复与显示","advanced":false,"when":{"streaming.mode":"progress"},"help":"显示模型已提交的阶段性公开文字（📝 草稿）与简短执行说明（💬）；不包含尚未提交的实时正文草稿。任务完成后不保留中间进度。"},{"key":"streaming.progress.toolDetail","label":"显示命令与目标摘要","type":"boolean","group":"回复与显示","advanced":false,"when":{"streaming.mode":"progress"},"help":"在工具名后附上简短目标，例如“执行命令 · npm pack”；敏感内容自动打码。"},{"key":"streaming.progress.draft","label":"显示草稿过程","type":"boolean","group":"回复与显示","advanced":false,"when":{"streaming.mode":"progress"},"help":"控制最终回复是否保留本轮的草稿过程，关闭后只发送正式回复。与「显示思考」不同：那个控制进度卡里的未提交内容。默认开启。"},{"key":"streaming.progress.narration","label":"显示思考","type":"boolean","group":"回复与显示","advanced":false,"when":{"streaming.mode":"progress"},"help":"仅在已认领主人的 Discord 私聊中，显示模型实际产生的思考，以及正在生成、尚未提交的正文草稿。已提交的阶段性公开文字由「显示简短执行说明」控制。群聊和其他私聊不会展示未提交内容；任务结束后清除临时进度。默认关闭。"},{"key":"throttleMs","group":"回复与显示","label":"进度消息刷新间隔（毫秒）","type":"number","min":400,"max":5000,"when":[{"streaming.mode":"progress"},{"streaming.mode":"partial"}],"advanced":false,"fold":"更多显示设置","help":"Discord 默认 1100 毫秒。将这段时间内的思考、草稿和工具进度合并后更新同一条消息，适用于执行进度和实时正文模式；不改变模型生成速度或工具执行间隔。设置过短可能增加 Discord 编辑请求并触发限流。"},{"key":"streaming.progress.maxLines","label":"最多显示进度条目","type":"number","group":"回复与显示","advanced":false,"when":{"streaming.mode":"progress"},"min":1,"max":12,"fold":"更多显示设置","help":"默认显示最近 5 个逻辑进度条目：一段思考、一条草稿或一项工具各算一条，段落换行不额外计数。超过上限时，空间足够则优先保留最近的思考和草稿，剩余位置显示最近工具与简短说明。"},{"key":"streaming.progress.maxLineChars","label":"工具与简短说明字数上限","type":"number","group":"回复与显示","advanced":false,"when":{"streaming.mode":"progress"},"min":40,"max":300,"fold":"更多显示设置","help":"默认每条 120 字符，限制工具状态、目标摘要及简短执行说明的显示长度；不控制思考或正文草稿，它们使用下方的独立字数上限。"},{"key":"streaming.progress.draftMaxChars","label":"思考与草稿单条字数上限","type":"number","group":"回复与显示","advanced":false,"when":{"streaming.mode":"progress"},"min":120,"max":1000,"fold":"更多显示设置","help":"默认每条 600 字符，限制每个思考或草稿进度条目的显示长度，保留原有段落并优先展示末尾。这不是模型输出上限；Discord 整条消息空间不足时仍会自动缩短。"},{"key":"ownerMode","group":"主人与记忆","label":"主人认领方式","type":"select","options":[["first-dm","首次私聊自动认领（默认）"],["manual","手动指定主人"]],"help":"首次认领仅接受该机器人首位私聊用户；群聊不会认领。认领后永久保存，重启或新会话不会更换。","advanced":false},{"key":"ownerUserId","group":"主人与记忆","label":"主人平台用户 ID","type":"text","when":{"ownerMode":"manual"},"help":"手动填写 Discord 用户 ID；保存后立即覆盖该渠道主人。","advanced":false},{"key":"ownerStatus","group":"主人与记忆","label":"当前主人","type":"readonly","detail":"ownerStatus","help":"当前主人已持久记录，不因重启或新建会话改变。","advanced":false},{"key":"memoryNamespace","group":"主人与记忆","label":"记忆命名空间","type":"text","advanced":false,"fold":"更多身份与记忆设置"},{"key":"identityLinks","group":"主人与记忆","label":"跨渠道身份绑定","type":"list","help":"可选，每行填写 用户ID=共同身份标识；只接受允许列表中的用户，双方填写相同标识才共享私聊。","advanced":false,"fold":"更多身份与记忆设置"},{"key":"attachments","group":"附件与传输","label":"接收附件","type":"boolean","advanced":false},{"key":"maxAttachmentMB","group":"附件与传输","label":"单附件大小限制（MiB）","type":"number","min":1,"max":20,"advanced":false}],"credentialTitle":"机器人凭证","credentialsFirst":true,"packageName":"dsh-channel-core"},"feishu":{"rowId":"channel-feishu","endpoint":"feishuChannelSettings","title":"飞书渠道","description":"将飞书消息接入 DSH 原生会话，支持回复、附件和渠道设置。","standalone":true,"actionLabel":"重新连接","fields":[{"key":"enabled","label":"连接渠道","type":"boolean","help":"保存后自动连接；有效凭证用于登录，消息接收范围单独配置。","group":"账号与连接","advanced":false},{"key":"accountId","label":"账号标识","type":"text","help":"本地用于区分机器人账号，配置后保持稳定。","group":"账号与连接","advanced":false,"fold":"更多连接设置"},{"key":"domain","label":"应用区域","type":"select","options":[["feishu","飞书"],["lark","Lark"]],"group":"账号与连接","advanced":false,"fold":"更多连接设置"},{"key":"appSecretRef","label":"凭证名称","type":"text","help":"密钥在下方凭证区单独保存，config.json 只保存引用名称。","group":"账号与连接","advanced":false,"fold":"更多连接设置"},{"key":"allowedUsers","group":"接收与权限","label":"允许使用的用户 ID","type":"list","help":"每行一个；留空时仍可连接，但不接收会话消息。","advanced":false},{"key":"allowGroups","group":"接收与权限","label":"接收群聊消息","type":"boolean","advanced":false},{"key":"autoCollectGroups","label":"自动收录新群","type":"boolean","group":"接收与权限","advanced":false,"help":"开启后，收到新群消息时会自动把该群加入下面的名单，省去手工查找群 ID。注意：群成员仍需在「允许的用户」名单中才会被响应。默认关闭。"},{"key":"allowedGroups","group":"接收与权限","label":"允许的群 chat_id","type":"list","help":"每行一个；只有列表中的会话可以进入 DSH。","advanced":false,"when":{"allowGroups":true}},{"key":"requireMention","group":"接收与权限","label":"群聊需要 @ 机器人","type":"boolean","advanced":false,"when":{"allowGroups":true}},{"key":"rolePreset","group":"会话与输入","label":"使用角色","type":"role","help":"从「指令文件与角色」选择角色，渠道新会话自动进入对应工作区。","advanced":false},{"key":"inputMode","group":"会话与输入","label":"新消息输入方式","type":"select","options":[["inherit","跟随“渠道与会话”设置"],["steering","Steering：加入当前任务"],["queue","Queue：排入后续轮次"],["interrupt","Interrupt：停止当前轮次并接收新输入"]],"advanced":false},{"key":"agentPreset","group":"会话与输入","label":"Agent 预设 ID","type":"preset","help":"从本机已注册的预设中选择；留空跟随宿主默认预设。","when":{"rolePreset":""},"advanced":false,"fold":"更多会话设置"},{"key":"workspacePath","group":"会话与输入","label":"工作区路径","type":"text","help":"未选择角色时生效。留空使用官方默认工作区；填写后按工作区隔离会话。","when":{"rolePreset":""},"advanced":false,"fold":"更多会话设置"},{"key":"resolvedWorkspace","label":"实际工作区","type":"readonly","detail":"workspacePath","placeholder":"渠道连接后显示","help":"显示渠道新会话实际使用的目录。","group":"会话与输入","advanced":false,"fold":"更多会话设置"},{"key":"streaming.mode","group":"回复与显示","label":"回复显示方式","type":"select","options":[["progress","执行进度（progress）"],["partial","实时正文（partial）"],["off","仅最终回复（off）"]],"help":"进度模式显示草稿、思考（独立开关）和工具；Discord 完成后仅保留正文，飞书完成后分别显示「过程记录」折叠卡和独立正文卡。","advanced":false},{"key":"streaming.cardEngine","group":"回复与显示","label":"飞书卡片引擎","type":"select","options":[["cardkit","CardKit 流式组件（推荐）"],["patch","兼容模式（整卡更新）"]],"help":"默认 CardKit：流式文字更新卡片文本组件，结束或提问时再更新完整卡片。创建 CardKit 卡片失败且尚未发消息时自动回退兼容模式；无法确认消息是否已经发出时不会盲目重试，避免重复卡片。刷新间隔仍按下方设置。","advanced":false},{"key":"streaming.finalFormat","group":"回复与显示","label":"最终回复形式","type":"select","options":[["auto","自动：私聊纯文本、群聊卡片"],["card","卡片（带状态栏与过程记录）"],["text","纯文本（所有会话）"]],"help":"自动：私聊按手机阅读处理，最终答复作为普通消息发送，长按即可选中复制；群聊仍用卡片，排版和过程记录更清楚。卡片适合阅读，但长文本要先展开再复制。纯文本发送前会撤回进度卡片。","advanced":false},{"key":"streaming.progress.toolProgress","group":"回复与显示","label":"显示工具进度","type":"boolean","advanced":false,"when":{"streaming.mode":"progress"}},{"key":"streaming.progress.commentary","group":"回复与显示","label":"显示简短执行说明","type":"boolean","advanced":false,"when":{"streaming.mode":"progress"},"help":"显示模型公开的简短执行说明；最终回复不保留工具进度。"},{"key":"streaming.progress.toolDetail","group":"回复与显示","label":"显示命令与目标摘要","type":"boolean","advanced":false,"when":{"streaming.mode":"progress"},"help":"在工具名后附上简短目标，例如“执行命令 · npm pack”；摘要经过脱敏，但不要在命令中放置凭证。"},{"key":"streaming.progress.draft","group":"回复与显示","label":"显示草稿过程","type":"boolean","advanced":false,"when":{"streaming.mode":"progress"},"help":"控制最终回复是否保留本轮的草稿过程，关闭后只发送正式回复。与「显示思考」不同：那个控制进度卡里的未提交内容。默认开启。"},{"key":"streaming.progress.narration","group":"回复与显示","label":"显示思考","type":"boolean","advanced":false,"when":{"streaming.mode":"progress"},"help":"仅在已认领主人的飞书私聊显示真实思考；草稿有独立开关。结束后有过程文字时归入默认折叠的「过程记录」，默认关闭。"},{"key":"throttleMs","group":"回复与显示","label":"进度卡片刷新间隔（毫秒）","type":"number","min":400,"max":5000,"advanced":false,"when":[{"streaming.mode":"progress"},{"streaming.mode":"partial"}],"fold":"更多显示设置","help":"当前默认 750 毫秒，将多次进度变化合并后更新同一张飞书卡片。openclaw-lark 的 CardKit 和普通消息 Patch 参考值分别约 100/1500 毫秒，属于不同路径，不应照搬为安全阈值。"},{"key":"streaming.progress.maxLines","group":"回复与显示","label":"最多显示进度条目","type":"number","min":1,"max":12,"advanced":false,"when":{"streaming.mode":"progress"},"fold":"更多显示设置","help":"默认最多 9 个逻辑条目；一个多段落思考或草稿仍只算一条。思考在上、草稿居中、工具在下；工具再多也会尽量保留最近的思考和草稿。"},{"key":"streaming.progress.maxLineChars","group":"回复与显示","label":"工具与简短说明字数上限","type":"number","min":40,"max":300,"advanced":false,"when":{"streaming.mode":"progress"},"fold":"更多显示设置","help":"默认每条 240 字符，只限制工具状态与简短说明。思考和正文草稿使用独立字数上限；最终正文不会因本项截断。"},{"key":"streaming.progress.draftMaxChars","group":"回复与显示","label":"思考与草稿单条字数上限","type":"number","min":120,"max":1000,"advanced":false,"when":{"streaming.mode":"progress"},"fold":"更多显示设置","help":"默认 600 字符，保留思考与草稿的原始段落换行，超出时优先显示最新部分；不限制模型实际输出，也不影响最终正文。"},{"key":"streaming.footer.status","group":"回复与显示","label":"显示状态","type":"boolean","advanced":false,"fold":"更多显示设置","help":"完成卡底部显示已完成、出错或停止。默认关闭。"},{"key":"streaming.footer.elapsed","group":"回复与显示","label":"显示任务耗时","type":"boolean","advanced":false,"fold":"更多显示设置","help":"从当前会话本轮执行开始计时。默认关闭。"},{"key":"streaming.footer.model","group":"回复与显示","label":"显示模型名称","type":"boolean","advanced":false,"fold":"更多显示设置","help":"默认开启；从 DSH 当前会话读取，无法确认时不展示。"},{"key":"streaming.footer.context","group":"回复与显示","label":"显示上下文用量","type":"boolean","advanced":false,"fold":"更多显示设置","help":"默认开启；从 DSH 原生 Token Meter 读取，读不到时不展示。"},{"key":"streaming.footer.tokens","group":"回复与显示","label":"显示输入／输出 Token","type":"boolean","advanced":false,"fold":"更多显示设置","help":"默认关闭；仅在实际用量指标可用时显示。"},{"key":"streaming.footer.cache","group":"回复与显示","label":"显示缓存用量","type":"boolean","advanced":false,"fold":"更多显示设置","help":"默认关闭；仅在真实缓存读写指标可用时显示。"},{"key":"ownerMode","group":"主人与记忆","label":"主人认领方式","type":"select","options":[["first-dm","首次私聊自动认领（默认）"],["manual","手动指定主人"]],"help":"首次认领仅接受该机器人首位私聊用户；群聊不会认领。认领后永久保存，重启或新会话不会更换。","advanced":false},{"key":"ownerUserId","group":"主人与记忆","label":"主人平台用户 ID","type":"text","when":{"ownerMode":"manual"},"help":"手动模式填写 Discord 用户 ID 或飞书 open_id，保存后立即覆盖该渠道主人。两个渠道分别认领，统一访问 DSH 主人记忆。","advanced":false},{"key":"ownerStatus","group":"主人与记忆","label":"当前主人","type":"readonly","detail":"ownerStatus","help":"第一位私聊者认领后自动更新；设置页可刷新查看。此信息保存在 Channel Core 数据库，而不是旧渠道配置文件。","advanced":false},{"key":"memoryNamespace","group":"主人与记忆","label":"记忆命名空间","type":"text","advanced":false,"fold":"更多身份与记忆设置"},{"key":"identityLinks","group":"主人与记忆","label":"跨渠道身份绑定","type":"list","help":"可选的高级功能：每行 用户ID=共同身份标识，用于跨渠道共用同一个 Session。仅共享长期记忆时无需设置此项。","advanced":false,"fold":"更多身份与记忆设置"},{"key":"attachments","group":"附件与传输","label":"接收附件","type":"boolean","advanced":false},{"key":"maxAttachmentMB","group":"附件与传输","label":"单附件大小限制（MiB）","type":"number","min":1,"max":20,"advanced":false}],"packageName":"dsh-channel-core"}};
  const bundledConfigCss="\n      .dpc-page{max-width:760px;color:var(--dsw-alias-label-primary);font-size:14px}\n      .dpc-page p,.dpc-page small{line-height:1.65;color:var(--dsw-alias-label-secondary)}\n      .dpc-page [role=alert]{color:var(--dsw-alias-state-error-primary,#d64545)}\n      .dpc-group+.dpc-group{margin-top:28px}.dpc-group h4{margin:0 0 8px;font-size:14px;font-weight:600}\n      .dpc-fold{margin:12px 0 0;padding:12px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}\n      .dpc-fold>summary{font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary)}\n      .dpc-fold[open]>summary{margin-bottom:8px}.dpc-fold .dpc-field:last-child{border-bottom:0}\n      .dpc-field{display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,280px);gap:24px;padding:18px 0;border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center}\n      .dpc-label label{line-height:22px;font-weight:500}.dpc-label small{display:block;margin-top:4px;font-size:12px}\n      .dpc-control{min-width:0}.dpc-boolean .dpc-control{justify-self:end}\n      .dpc-status{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);word-break:break-word;line-height:1.6}\n      .dpc-field input:not([type=checkbox]),.dpc-field select,.dpc-field textarea{box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit}.dpc-field textarea{resize:vertical;line-height:1.6}\n      .dpc-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:24px}\n      .dpc-order{margin:0;padding:0;list-style:none;display:grid;gap:4px}.dpc-order li{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}\n      .dpc-rank{font-size:12px;color:var(--dsw-alias-label-tertiary);width:20px;text-align:center;font-variant-numeric:tabular-nums}.dpc-provider-name{flex:1}.dpc-order-actions{display:flex;gap:2px}.dpc-arrow{min-width:28px;padding:0!important}\n      .dpc-providers,.dpc-order{grid-template-columns:1fr;gap:12px}.dpc-choice{display:inline-flex;gap:4px;margin:4px 12px 4px 0}\n      .dpc-note{font-size:12px}.dpc-path{overflow-wrap:anywhere;margin-top:16px;color:var(--dsw-alias-label-tertiary);font-size:12px}.dpc-path code{display:block;margin-top:8px;user-select:text}\n      .dpc-credentials{border-top:1px solid var(--dsw-alias-border-l2);margin-top:24px;padding-top:18px}.dpc-credentials fieldset{border:0;padding:0;min-width:0}.dpc-page summary{cursor:pointer;line-height:22px}\n      .dpc-credentials:first-child{border-top:0;margin-top:0;padding-top:0;margin-bottom:28px}.dpc-credentials h4{margin:0;font-size:14px;font-weight:600}\n      .dpc-advanced{margin-top:28px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.dpc-advanced>summary{font-weight:500}.dpc-advanced[open]>summary{margin-bottom:20px}\n      .dpc-credentials .dpc-field{grid-template-columns:140px minmax(0,1fr) auto;gap:14px}.dpc-credentials .dpc-actions{margin:0}\n      .dpc-credentials-inline fieldset{border:0;padding:0;margin:0;min-width:0}.dpc-inline-secret{display:grid;gap:8px}.dpc-inline-secret .dpc-actions{display:flex;flex-wrap:wrap;gap:8px;margin:0}.dpc-inline-secret .dpc-actions button{font-size:12px}\n      .dpc-page :is(select,input,textarea):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:3px}\n      [data-plugin-detail=\"dsh-channel-core\"] [data-plugin-rows]:has(>ul>[data-plugin-row]:only-child):not(:has([data-state=failed],[data-state=off])){display:none}\n      @media(max-width:620px){.dpc-field,.dpc-credentials .dpc-field{grid-template-columns:1fr;gap:10px}.dpc-boolean{grid-template-columns:1fr auto;gap:20px}}\n    ";
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
    const [workspaceDraft,setWorkspaceDraft]=React.useState('');
    const [manualPath,setManualPath]=React.useState(false);
    const [missingPath,setMissingPath]=React.useState('');
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
    const enableChannel=async()=>{
      try{const fresh=await scope.reload();await scope.update({...fresh.value,enabled:true},fresh.revision);await scope.reload();setNotice('已开启连接渠道');}
      catch(error){setNotice('开启失败：'+error.message);}
    };
    const saveWorkspacePath=async value=>{
      try{const fresh=await scope.reload();await scope.update({...fresh.value,workspacePath:value},fresh.revision);await scope.reload();setNotice('已保存工作区：'+value);setMissingPath('');}
      catch(error){setNotice('保存失败：'+error.message);}
    };
    // A typed path is checked before it is stored: a typo used to surface only
    // when the first message failed. A missing directory is offered for creation
    // instead of being saved silently.
    const saveWorkspace=async()=>{
      const value=workspaceDraft.trim();
      if(!value){setNotice('请填写工作区路径，例如 G:\DSWork');return;}
      let status;
      try{status=await scope.call('directoryCheck',{path:value});}
      catch(error){setNotice('无法检查该路径：'+error.message);return;}
      if(status&&status.exists&&status.isDirectory===false){setNotice('该路径是文件，不是目录：'+value);return;}
      if(!status||status.exists!==true){setMissingPath(value);setNotice('目录不存在：'+value);return;}
      await saveWorkspacePath(value);
    };
    const createWorkspace=async()=>{
      const value=missingPath;
      if(!value)return;
      try{await scope.call('directoryCreate',{path:value});}
      catch(error){setNotice('创建失败：'+error.message);return;}
      await saveWorkspacePath(value);
    };
    // Native directory picker: the desktop bridge opens the OS dialog, which also
    // allows creating a folder inside it — far safer than typing a path by hand.
    const pickWorkspace=async()=>{
      const bridge=globalThis.__DSH_DIRECTORY_PICKER__;
      if(!bridge||typeof bridge.pick!=='function'){
        setManualPath(true);
        setNotice('当前客户端不支持系统目录选择，请手动填写路径。');
        return;
      }
      let picked=null;
      try{picked=await bridge.pick();}
      catch(error){setNotice('打开系统目录选择器失败：'+(error&&error.message?error.message:'未知原因'));return;}
      if(typeof picked!=='string'||!picked)return;
      await saveWorkspacePath(picked);
    };
    const healthBlock=()=>{
      if(!health.some(row=>!row.ok))return null;
      return e('div',{className:'dcb-health'},
        e('strong',null,'首次使用还差这几项'),
        e('ul',null,health.map(row=>e('li',{key:row.key,className:row.ok?'dcb-ok':'dcb-todo'},
          e('span',null,(row.ok?'✅ ':'⚠️ ')+row.label),
          row.ok?null:(row.key==='enabled'
            ?e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{void enableChannel();}},'打开连接渠道')
            :e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{void addRobot();}},'添加机器人'))))));
    };
    // The workspace is not a one-time setting: it must stay replaceable after the
    // health block disappears (which happens once all three checks pass).
    const workspaceLine=()=>e('div',{className:'dcb-health dcb-workspace'},
      e('div',{className:'dcb-health-head'},
        e('strong',null,'工作区：'+(workspaceValue||'未设置')),
        e('span',{className:'dcb-health-form'},
          e('button',{type:'button',className:'dcb-bot-btn',onClick:()=>{void pickWorkspace();}},workspaceValue?'更换目录…':'选择目录…'),
          e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>setManualPath(v=>!v)},manualPath?'收起':'手动填写'))),
      manualPath?e('div',{className:'dcb-health-form'},
        e('input',{type:'text',value:workspaceDraft,placeholder:'例如 G:\DSWork','aria-label':'工作区路径',
          onChange:event=>setWorkspaceDraft(event.target.value)}),
        e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{void saveWorkspace();}},'保存'),
        missingPath?e(React.Fragment,null,
          e('span',{className:'dcb-reg-err'},'目录不存在'),
          e('button',{type:'button',className:'dcb-bot-btn',onClick:()=>{void createWorkspace();}},'创建并保存'),
          e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{setMissingPath('');setNotice('');}},'取消')):null):null);
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
      setWorkspaceDraft('');
      setManualPath(false);
      setMissingPath('');
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
    // the App ID as G:DSWork<appId>, so appId uniqueness gives folder uniqueness.
    const [addMode,setAddMode]=React.useState('quick');
    const [manualAppId,setManualAppId]=React.useState('');
    const [manualSecret,setManualSecret]=React.useState('');
    const addRobot=async()=>{
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
          e('button',{type:'button',className:'dcb-bot-btn',disabled:accountBusy==='add',onClick:()=>{void addRobot();}},'+ 添加机器人')),
        e('p',{className:'dcb-bot-link'},accounts.length?'每个机器人使用独立工作区、独立会话；同一个机器人只能添加一次。':'还没有机器人，点「+ 添加机器人」开始。'),
        addScan?e('div',{className:'dcb-reg-body'},
          e('div',{className:'dcb-bot-meta'},
            e('div',{className:'dcb-add-tabs'},
              e('button',{type:'button',className:addMode==='quick'?'dcb-add-tab dcb-add-tab-on':'dcb-add-tab',onClick:()=>setAddMode('quick')},'快捷配置'),
              e('button',{type:'button',className:addMode==='manual'?'dcb-add-tab dcb-add-tab-on':'dcb-add-tab',onClick:()=>setAddMode('manual')},'手动配置')),
            // The workspace belongs to the bot being added; show it and allow a
            // change before anything is created.
            e('div',{className:'dcb-add-workspace'},
              e('span',null,'工作区：'+(addWorkspace||'未选择')),
              e('button',{type:'button',className:'dcb-bot-copy',onClick:()=>{void chooseWorkspace();}},addWorkspace?'更换目录…':'选择目录…')),
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
      workspaceLine(),
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

    const NS = 'channelCoreSettings';
    const locales = {
      zh: {
        mode: '忙碌时收到新输入', steering: 'Steering · 补充当前任务', queue: 'Queue · 排队执行', interrupt: 'Interrupt · 结束当前轮后接收',
        steeringHelp: '新消息在步骤边界接入当前任务。', queueHelp: '新消息进入待办，在后续轮次执行。',
        interruptHelp: '使用原生取消结束当前轮，再接收新消息；待办遵循 DSH 原生规则。',
        sharedDM: '跨渠道共享私聊会话', sharedDMHelp: '已验证为同一人的渠道账号，在同一工作区和预设下共享会话。群聊与 thread 独立。',
        taskNotifications: '任务通知', taskNotificationsHelp: '自动任务执行失败时，通知指定渠道中已验证的主人私聊。不影响任务本身；正常完成时不发送。',
        notificationChannel: '通知渠道', noChannel: '无', noConfiguredChannel: '尚无已启用并配置的渠道；可先保存开关，配置渠道后再选择。', channelUnavailable: '（当前不可用）',
        save: '保存', saving: '正在保存…', saved: '已保存', loading: '正在读取配置…', retry: '重新读取', discard: '放弃修改并重新读取',
        unsaved: '有未保存的修改', external: '配置已在其他页面或文件中修改，请重新读取后保存。',
        effect: '保存后立即生效，后续输入使用新配置。', file: '配置文件', readFailed: '读取失败，请确认插件已启用后重试。',
        saveFailed: '保存失败，请重试。', unavailable: '插件已停用或连接已断开，请重新启用或连接后重试。',
        invalid: '配置文件有误，当前继续使用上一次有效值。可以修正文件，或在这里保存有效配置。',
        summary: '设置多渠道输入策略与私聊会话共享。',
      },
      en: {
        mode: 'New input while busy', steering: 'Steering · add to the current task', queue: 'Queue · run in a later turn', interrupt: 'Interrupt · end this turn and accept input',
        steeringHelp: 'New messages join the current task at a step boundary.', queueHelp: 'New messages enter the inbox for a later turn.',
        interruptHelp: 'Use native cancellation, then accept the message. Pending input follows DSH native rules.',
        sharedDM: 'Share direct-message sessions across channels', sharedDMHelp: 'Verified accounts for the same person share sessions within the same workspace and preset. Groups and threads remain separate.',
        taskNotifications: 'Task notifications', taskNotificationsHelp: 'Send failed scheduled-task alerts to the verified owner DM on the selected channel. Successful runs stay silent.',
        notificationChannel: 'Notification channel', noChannel: 'None', noConfiguredChannel: 'No configured and enabled channels yet. You can save this switch and choose a channel later.', channelUnavailable: ' (currently unavailable)',
        save: 'Save', saving: 'Saving…', saved: 'Saved', loading: 'Loading configuration…', retry: 'Reload', discard: 'Discard changes and reload',
        unsaved: 'Unsaved changes', external: 'Configuration changed in another page or file. Reload before saving.',
        effect: 'Changes apply immediately to subsequent input.', file: 'Configuration file', readFailed: 'Could not load configuration. Enable the plugin and retry.',
        saveFailed: 'Could not save. Please retry.', unavailable: 'The plugin is disabled or disconnected. Enable it or reconnect and retry.',
        invalid: 'The configuration file is invalid. The last valid values remain active. Fix the file or save valid values here.',
        summary: 'Configure multi-channel input policy and shared direct-message sessions.',
      },
    };
    const same = (a, b) => a && b && a.defaultMode === b.defaultMode && a.sharedDM === b.sharedDM && a.taskNotifications === b.taskNotifications && a.notificationChannel === b.notificationChannel && a.schemaVersion === b.schemaVersion;
    const css = `
      .dcc-config{max-width:680px;color:var(--dsw-alias-label-primary);font-size:14px}
      .dcc-config fieldset{border:0;padding:0;margin:0;min-width:0}.dcc-config fieldset:disabled{opacity:.65}
      .dcc-field{display:block;padding:18px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .dcc-title{display:block;font-weight:600;margin-bottom:9px}.dcc-help{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.65;margin:8px 0 0}
      .dcc-select{width:100%;max-width:370px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base);font:inherit}
      .dcc-check{display:flex;align-items:center;justify-content:space-between;gap:24px}.dcc-check .dcc-title{margin:0}
      .dcc-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:20px}
      .dcc-button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;padding:8px 14px;cursor:pointer;font:inherit}
      .dcc-button[type=submit]{background:var(--dsw-alias-brand-primary,#4d6bfe);color:white;border-color:transparent}.dcc-button:disabled{opacity:.5;cursor:default}
      .dcc-config :is(button,select,input):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:3px}
      .dcc-notice{margin-top:14px;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
      .dcc-error{color:var(--dsw-alias-state-error-primary,#d64545)}.dcc-file{margin-top:24px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
      .dcc-file code{display:block;margin-top:6px;overflow-wrap:anywhere;user-select:text}
      .dcc-management{margin-top:32px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:24px}.dcc-management h3{font-size:16px;margin:0 0 12px}.dcc-management h4{font-size:14px;margin:18px 0 8px}
      .dcc-accounts,.dcc-bindings{display:grid;gap:10px}.dcc-account,.dcc-binding{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.dcc-account{display:flex;gap:12px;align-items:start}.dcc-account span{min-width:0}.dcc-account code,.dcc-binding code{font-size:12px;overflow-wrap:anywhere}.dcc-binding select{max-width:100%;margin-top:10px}
      .dcc-review{margin-top:18px;padding:16px;border:1px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:12px}.dcc-review-group{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}.dcc-review-group ul{padding-left:20px}.dcc-id-input{box-sizing:border-box;width:100%;max-width:370px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;color:inherit;background:var(--dsw-alias-bg-base)}
      [data-plugin-detail="dsh-channel-core"] [data-plugin-rows]:has(>ul>[data-plugin-row]:only-child):not(:has([data-state=failed],[data-state=off])){display:none}
    `;

    class ConfigClient {
      constructor(connection) { this.connection = connection; this.requests = new Set(); this.closed = false }
      async call(method, args) {
        if (this.closed) throw new Error('Plugin configuration is unavailable');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        this.requests.add(controller);
        try {
          const result = await this.connection.rpc.call('/api', 'channelCore/' + method, { args }, controller.signal);
          if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
          return result.value;
        } finally { clearTimeout(timeout); this.requests.delete(controller) }
      }
      get() { return this.call('getConfig', {}) }
      save(value, revision) { return this.call('setConfig', { value, revision }) }
      close() { this.closed = true; for (const request of this.requests) request.abort(); this.requests.clear() }
    }

    const BindingPanel=React.forwardRef(function BindingPanel({connection,onApplied},ref){
      const [state,setState]=React.useState({catalog:null,loading:true,busy:false,error:'',review:null,choices:{},selected:[],identity:'',saved:''});
      const client=React.useRef(null),epoch=React.useRef(0),serial=React.useRef(0),busy=React.useRef(false);
      const refresh=React.useCallback(async()=>{if(busy.current)return;const generation=epoch.current,request=++serial.current;
        try{const catalog=await client.current.call('bindingCatalog',{});if(epoch.current===generation&&serial.current===request)setState(value=>({...value,catalog,loading:false,error:''}));}
        catch(error){if(epoch.current===generation&&serial.current===request)setState(value=>({...value,loading:false,error:error.message}));}
      },[]);
      React.useEffect(()=>{epoch.current++;const owner=new ConfigClient(connection);client.current=owner;busy.current=false;void refresh();const focus=()=>{if(!document.hidden)void refresh();};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{epoch.current++;serial.current++;owner.close();window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};},[connection,refresh]);
      const preview=async request=>{if(busy.current)return;busy.current=true;const generation=epoch.current,sequence=++serial.current;setState(value=>({...value,busy:true,error:'',saved:''}));
        try{const catalog=await client.current.call('bindingCatalog',{}),review=await client.current.call('previewBindings',{request,revision:catalog.revision});if(epoch.current===generation&&serial.current===sequence)setState(value=>({...value,catalog,review,choices:Object.fromEntries(review.groups.map(group=>[group.id,request.kind==='binding'&&group.currentSessions.length===1?group.currentSessions[0]:'new'])),busy:false}));}
        catch(error){if(epoch.current===generation&&serial.current===sequence)setState(value=>({...value,busy:false,error:error.message}));throw error;}
        finally{if(epoch.current===generation)busy.current=false;}
      };
      React.useImperativeHandle(ref,()=>({previewSharing:config=>preview({kind:'sharing',sharedDM:config.sharedDM,config})}));
      const propose=request=>{void preview(request).catch(()=>{});};
      const apply=async()=>{if(busy.current||!state.review)return;busy.current=true;const generation=epoch.current,request=++serial.current;setState(value=>({...value,busy:true,error:'',saved:''}));
        try{await client.current.call('applyBindings',{proposalId:state.review.id,decisions:state.review.groups.map(group=>({id:group.id,sessionId:state.choices[group.id]})),confirmation:state.review.id});const catalog=await client.current.call('bindingCatalog',{});if(epoch.current===generation&&serial.current===request){setState(value=>({...value,catalog,review:null,selected:[],busy:false,saved:'已应用，后续输入使用新的绑定。'}));onApplied(state.review.kind);}}
        catch(error){if(epoch.current===generation&&serial.current===request)setState(value=>({...value,busy:false,error:error.message}));}
        finally{if(epoch.current===generation)busy.current=false;}
      };
      const selected=state.catalog?.aliases.filter(alias=>state.selected.includes(JSON.stringify([alias.provider,alias.accountId,alias.userId])))??[];
      const cancel=async()=>{if(busy.current||!state.review)return;busy.current=true;const generation=epoch.current;setState(value=>({...value,busy:true,error:''}));
        try{await client.current.call('cancelBindings',{proposalId:state.review.id});if(epoch.current===generation)setState(value=>({...value,review:null,busy:false,saved:'已取消审阅，现有路由保持不变。'}));}
        catch(error){if(epoch.current===generation)setState(value=>({...value,busy:false,error:error.message}));}finally{if(epoch.current===generation)busy.current=false;}
      };
      const aliasLabel=alias=>(alias.provider==='discord'?'Discord':'飞书')+' · '+alias.accountId+' · '+alias.userId;
      return e('section',{className:'dcc-management','aria-busy':state.loading||state.busy},
        e('h3',null,'身份与会话绑定'),e('p',{className:'dcc-help'},'先选择真实渠道账号，再审阅会话范围。确认同一人后可共享私聊；群聊和线程保持各自范围。'),
        state.loading?e('p',{role:'status'},'正在读取渠道账号与会话…'):null,
        state.catalog?e(React.Fragment,null,
          state.catalog.truncated?e('p',{className:'dcc-help'},'账号或绑定超过 500 项，当前展示前 500 项。'):null,
          e('h4',null,'渠道账号'),state.catalog.aliases.length?e('div',{className:'dcc-accounts'},...state.catalog.aliases.map(alias=>{const key=JSON.stringify([alias.provider,alias.accountId,alias.userId]);return e('label',{key,className:'dcc-account'},e('input',{type:'checkbox',checked:state.selected.includes(key),disabled:state.busy||alias.source==='channel-config',onChange:event=>{const checked=event.target.checked;setState(value=>({...value,selected:checked?[...value.selected,key]:value.selected.filter(item=>item!==key)}));}}),e('span',null,e('strong',null,aliasLabel(alias)),e('p',{className:'dcc-help'},alias.verified?'身份已确认':'尚未跨渠道绑定',' · ',e('code',null,alias.identityId),alias.source==='channel-config'?'；在对应渠道页管理此映射。':'')));})):e('p',{className:'dcc-help'},'尚无已接收的渠道账号。让账号先向机器人发送一条消息后，这里即可选择。'),
          selected.length?e(React.Fragment,null,e('label',{className:'dcc-field'},e('span',{className:'dcc-title'},'共同身份标识（可选）'),e('input',{className:'dcc-id-input',value:state.identity,maxLength:256,disabled:state.busy,onChange:event=>{const identity=event.target.value;setState(value=>({...value,identity}));}}),e('p',{className:'dcc-help'},'留空创建新的共同身份；填写已有标识时，审阅会包含该身份的现有账号。')),
            e('div',{className:'dcc-actions'},e(Button,{type:'button',variant:'outline',disabled:state.busy,onClick:()=>propose({kind:'link',aliases:selected,identityId:state.identity})},'审阅身份绑定'),selected.length===1?e(Button,{type:'button',variant:'outline',disabled:state.busy,onClick:()=>propose({kind:'unlink',aliases:selected})},'审阅解除绑定'):null)):null,
          e('h4',null,'当前渠道绑定'),e('p',{className:'dcc-help'},'列出后续消息使用的会话。审阅用于切换路由，关闭审阅后绑定仍会显示。'),state.catalog.bindings.length?e('div',{className:'dcc-bindings'},...state.catalog.bindings.map(binding=>e('div',{key:binding.id,className:'dcc-binding'},e('strong',null,(binding.provider==='discord'?'Discord':'飞书')+' · '+(binding.kind==='dm'?'私聊':binding.kind==='thread'?'线程':'群聊')+' · '+binding.conversationId),e('p',{className:'dcc-help'},e('code',null,binding.sessionId),' · ',({running:'执行中',idle:'已加载 · 空闲','awaiting-user':'等待回答','awaiting-approval':'等待审批',inactive:'未加载'})[binding.activity]??binding.activity),e('p',{className:'dcc-help'},'预设：',binding.scope.presetId,' · 记忆域：',binding.scope.memoryNamespace),
            e('div',{className:'dcc-actions'},e('select',{className:'dcc-select','aria-label':'输入方式 '+binding.id,disabled:state.busy,value:binding.inboundMode??'inherit',onChange:event=>propose({kind:'binding',bindingId:binding.id,inputMode:event.target.value})},...['inherit','steering','queue','interrupt'].map(value=>e('option',{key:value,value},({inherit:'跟随渠道设置',steering:'Steering：加入当前任务',queue:'Queue：排队',interrupt:'Interrupt：取消当前轮后接收'})[value]))),e(Button,{type:'button',variant:'outline',disabled:state.busy,onClick:()=>propose({kind:'binding',bindingId:binding.id})},'管理会话'))))):e('p',{className:'dcc-help'},'接收消息后显示对应会话。'),
          state.catalog.historical?.length?e('details',null,e('summary',null,'历史绑定 · '+state.catalog.historical.length),state.catalog.historical.map(binding=>e('p',{className:'dcc-help',key:binding.id},binding.provider,' · ',e('code',null,binding.sessionId),' · 已不使用此工作区路由'))):null,
          state.catalog.proposals.length?e('p',{className:'dcc-help',role:'status'},'有 ',state.catalog.proposals.length,' 个操作需要重新核对。历史会话仍保留，请重新准备审阅。'):null
        ):null,
        state.review?e('div',{className:'dcc-review'},e('h4',null,'审阅后应用'),e('p',{className:'dcc-help'},'只调整后续输入的路由，既有会话内容保持原样。请为每个范围选择继续已有会话或新建。'),
          state.review.aliases.length?e('ul',null,...state.review.aliases.map(alias=>e('li',{key:aliasLabel(alias)},aliasLabel(alias),' → ',e('code',null,alias.after)))):null,
          ...state.review.groups.map(group=>e('div',{className:'dcc-review-group',key:group.id},e('strong',null,group.workspace),e('p',{className:'dcc-help'},'预设：',group.scope.presetId,' · 记忆域：',group.scope.memoryNamespace),e('ul',null,...group.members.map(member=>e('li',{key:member.id},aliasLabel(member),' · ',member.conversationId,' · ',e('code',null,member.sessionId)))),e('select',{className:'dcc-select','aria-label':'目标会话 '+group.id,disabled:state.busy,value:state.choices[group.id],onChange:event=>{const sessionId=event.target.value;setState(value=>({...value,choices:{...value.choices,[group.id]:sessionId}}));}},e('option',{value:'new'},'新建会话'),...group.options.map(sessionId=>e('option',{key:sessionId,value:sessionId},'继续 '+sessionId))))),
          e('div',{className:'dcc-actions'},e(Button,{type:'button',variant:'primary',disabled:state.busy,onClick:()=>{void apply();}},state.busy?'正在应用…':'确认应用'),e(Button,{type:'button',variant:'outline',disabled:state.busy,onClick:()=>{void cancel();}},'取消审阅'))):null,
        state.error?e('div',{className:'dcc-notice dcc-error',role:'alert'},state.error,e('div',{className:'dcc-actions'},e(Button,{type:'button',variant:'outline',disabled:state.busy,onClick:()=>{void refresh();}},'重新读取'))):null,
        state.saved?e('p',{className:'dcc-help',role:'status'},state.saved):null
      );
    });

    function ConfigPage({ connection, t }) {
      const [state, setState] = React.useState({ snapshot: null, draft: null, loading: true, saving: false, error: '', external: false, saved: false });
      const [channels, setChannels] = React.useState([]);
      const client = React.useRef(null);
      const sequence = React.useRef(0);
      const mounted = React.useRef(false);
      const busy = React.useRef(false);
      const management=React.useRef(null);
      const reload = React.useCallback(async (discard = false) => {
        if (busy.current) return;
        const request = ++sequence.current;
        setState(previous => ({ ...previous, loading: !previous.snapshot, error: '', saved: false }));
        try {
          const [snapshot, available] = await Promise.all([client.current.get(), client.current.call('notificationChannels', {})]);
          if (!mounted.current || sequence.current !== request) return;
          setChannels(available);
          setState(previous => {
            const dirty = previous.draft && !same(previous.draft, previous.snapshot?.value);
            if (dirty && !discard) return { ...previous, loading: false, external: snapshot.revision !== previous.snapshot.revision };
            return { snapshot, draft: { ...snapshot.value }, loading: false, saving: false, error: '', external: false, saved: false };
          });
        } catch (error) {
          if (mounted.current && sequence.current === request) setState(previous => ({ ...previous, loading: false, error: t('readFailed') }));
        }
      }, [t]);
      React.useEffect(() => {
        mounted.current = true;
        busy.current = false;
        const owner = new ConfigClient(connection);
        client.current = owner;
        void reload();
        const focus = () => { void reload() };
        window.addEventListener('focus', focus);
        return () => { mounted.current = false; sequence.current++; owner.close(); window.removeEventListener('focus', focus) };
      }, [connection, reload]);
      const dirty = !same(state.draft, state.snapshot?.value);
      const edit = (field, value) => setState(previous => ({ ...previous, draft: { ...previous.draft, [field]: value }, saved: false }));
      const save = async event => {
        event.preventDefault();
        if (busy.current || !state.snapshot || state.external) return;
        busy.current = true;
        const request = ++sequence.current;
        setState(previous => ({ ...previous, saving: true, error: '', saved: false }));
        try {
          if(state.draft.sharedDM!==state.snapshot.value.sharedDM){await management.current.previewSharing(state.draft);if(mounted.current&&sequence.current===request)setState(previous=>({...previous,saving:false}));return;}
          const snapshot = await client.current.save(state.draft, state.snapshot.revision);
          if (mounted.current && sequence.current === request) setState({ snapshot, draft: { ...snapshot.value }, loading: false, saving: false, error: '', external: false, saved: true });
        } catch (error) {
          if (mounted.current && sequence.current === request) setState(previous => ({ ...previous, saving: false,
            external: error.code === 'channel-config/config-conflict', error: error.code === 'channel-config/config-conflict'||error.code?.startsWith('channel-binding/') ? '' : error.message || t('saveFailed'),
          }));
        } finally { if (sequence.current === request) busy.current = false }
      };
      return e('form', { className: 'dcc-config', onSubmit: save, 'aria-busy': state.loading || state.saving },
        state.loading ? e('p', { role: 'status' }, t('loading')) : null,
        state.snapshot ? e('fieldset', { disabled: state.saving || state.loading },
          e('label', { className: 'dcc-field' }, e('span', { className: 'dcc-title' }, t('mode')),
            e('select', { className: 'dcc-select', value: state.draft.defaultMode, onChange: event => edit('defaultMode', event.target.value) },
              ...['steering', 'queue', 'interrupt'].map(value => e('option', { key: value, value }, t(value)))),
            e('p', { className: 'dcc-help' }, t(state.draft.defaultMode + 'Help'))),
          e('div', { className: 'dcc-field' },
            e('div', { className: 'dcc-check' }, e('span', { className: 'dcc-title' }, t('sharedDM')),
              e(Switch, { label: t('sharedDM'), checked: state.draft.sharedDM, disabled: state.saving || state.loading, onChange: value => edit('sharedDM', value) })),
            e('p', { className: 'dcc-help' }, t('sharedDMHelp'))),
          e('div', { className: 'dcc-field' },
            e('div', { className: 'dcc-check' }, e('span', { className: 'dcc-title' }, t('taskNotifications')),
              e(Switch, { label: t('taskNotifications'), checked: state.draft.taskNotifications, disabled: state.saving || state.loading, onChange: value => edit('taskNotifications', value) })),
            e('p', { className: 'dcc-help' }, t('taskNotificationsHelp')),
            state.draft.taskNotifications ? e('label', { className: 'dcc-field' }, e('span', { className: 'dcc-title' }, t('notificationChannel')),
              e('select', { className: 'dcc-select', 'aria-label': t('notificationChannel'), value: state.draft.notificationChannel,
                onChange: event => edit('notificationChannel', event.target.value) },
                e('option', { value: 'none' }, t('noChannel')),
                ...channels.map(channel => e('option', { key: channel.id, value: channel.id }, channel.label)),
                state.draft.notificationChannel !== 'none' && !channels.some(channel => channel.id === state.draft.notificationChannel)
                  ? e('option', { value: state.draft.notificationChannel }, state.draft.notificationChannel + t('channelUnavailable')) : null),
              !channels.length ? e('p', { className: 'dcc-help' }, t('noConfiguredChannel')) : null) : null),
        ) : null,
        state.snapshot?.error ? e('p', { className: 'dcc-notice dcc-error', role: 'alert' }, t('invalid'), ' ', state.snapshot.error.message) : null,
        state.external ? e('p', { className: 'dcc-notice dcc-error', role: 'alert' }, t('external')) : null,
        state.error ? e('p', { className: 'dcc-notice dcc-error', role: 'alert' }, state.error) : null,
        e('div', { className: 'dcc-actions' },
          state.snapshot ? e(Button, { variant: 'primary', type: 'submit', disabled: state.saving || state.loading || state.external || (!dirty && !state.snapshot.error) }, t(state.saving ? 'saving' : 'save')) : null,
          state.external || state.error ? e(Button, { variant: 'outline', type: 'button', disabled: state.saving || state.loading, onClick: () => { void reload(true) } }, t(dirty && state.snapshot ? 'discard' : 'retry')) : null,
          e('span', { className: 'dcc-help', role: 'status' }, state.saved ? t('saved') : state.snapshot && dirty ? t('unsaved') : ''),
        ),
        e('p', { className: 'dcc-notice' }, t('effect')),
        state.snapshot ? e('details', { className: 'dcc-file' }, e('summary', null, t('file')), e('code', null, state.snapshot.configFile)) : null,
        state.snapshot?e(BindingPanel,{ref:management,connection,onApplied:kind=>{void reload(kind==='sharing');}}):null,
      );
    }

    return {
      inject: ['slots', 'locale', 'connection', 'remote', 'remote.credentials', 'sessions'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, locales));
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = css; document.head.appendChild(style);
          return () => style.remove();
        });
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config', key: 'dsh-channel-core', locale: NS,
        }, ({ t, view }) => view === 'summary' ? t('summary') : e(ChannelBundlePage, { t, connection: ctx.connection, credentialApi: ctx.remote?.credentials })));
      },
    };
  },
});
