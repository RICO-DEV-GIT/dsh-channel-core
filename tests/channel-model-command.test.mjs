import test from 'node:test';
import assert from 'node:assert/strict';
import { channelModelCommand } from '../lib/channel-model-command.js';
import { ChannelRuntime } from '../lib/channel-runtime.js';

const catalog={default:{provider:'p',model:'alpha'},
 groups:[{id:'p',name:'Provider',models:[
  {id:'alpha',name:'Alpha',reasoning:{defaultEffort:'low',efforts:[{id:'off',name:'关闭'},{id:'low',name:'低'},{id:'max',name:'最高'}]}},
  {id:'beta',name:'Beta'}]}]};
function host(overrides={}){
 const writes=[];
 const controller={
  modelCatalog:async()=>catalog,
  projections:async()=>({values:{modelSelection:{next:{provider:'p',model:'alpha',reasoningEffort:'off'}}}}),
  selectModel:async request=>{writes.push(request);return{selected:request};},...overrides};
 return{controller,writes};
}
test('Feishu text model command lists real models and switches only valid choices',async()=>{
 const {controller,writes}=host();
 const shown=await channelModelCommand(controller,'s1','model','');
 assert.match(shown,/当前模型：p\/alpha/);
 assert.match(shown,/p\/beta/);
 const rejected=await channelModelCommand(controller,'s1','model','p/nonexistent');
 assert.match(rejected,/未找到/);assert.equal(writes.length,0);
 const ok=await channelModelCommand(controller,'s1','model','p/alpha');
 assert.match(ok,/从下一次请求开始生效/);
 assert.deepEqual(writes,[{sessionId:'s1',provider:'p',model:'alpha',reasoningEffort:'low'}]);
});
test('Feishu /think presents only published efforts and never accepts arbitrary values',async()=>{
 const {controller,writes}=host();
 const shown=await channelModelCommand(controller,'s1','think','');
 assert.match(shown,/可选强度/);
 assert.match(shown,/max/);
 assert.match(await channelModelCommand(controller,'s1','think','insane'),/不可用/);
 assert.equal(writes.length,0);
 await channelModelCommand(controller,'s1','think','max');
 assert.deepEqual(writes,[{sessionId:'s1',provider:'p',model:'alpha',reasoningEffort:'max'}]);
 const unsupported=host({projections:async()=>({values:{modelSelection:{next:{provider:'p',model:'beta'}}}})});
 assert.match(await channelModelCommand(unsupported.controller,'s1','think','max'),/没有公布/);
 assert.equal(unsupported.writes.length,0);
});
test('Feishu model changes propagate native errors instead of reporting success',async()=>{
 const x=host({selectModel:async()=>{throw new Error('native-refused');}});
 await assert.rejects(channelModelCommand(x.controller,'s1','model','p/beta'),/native-refused/);
});
test('channel runtime routes /model and /think only after sender authorization; Discord text stays ordinary',async()=>{
 const calls=[],fakeCore={
  store:{setOwner:()=>{}},
  command:async(msg,cmd,args)=>{calls.push(['command',cmd,args,msg.userId]);return{accepted:true};},
  receive:async msg=>{calls.push(['message',msg.text]);return{accepted:true};}};
 const runtime=Object.create(ChannelRuntime.prototype);
 Object.assign(runtime,{core:fakeCore,closed:false,provider:'feishu',lastEventAt:null,diagnostic:()=>{},sessionContext:async()=>({create:{cwd:'E:/test'},scope:{workspaceId:'test'}})});
 const cfg={accountId:'default',ownerMode:'manual',ownerUserId:'allowed',dmPolicy:'allowlist',allowedUsers:['allowed'],allowGroups:false,groupPolicy:'allowlist',allowedGroups:[],requireMention:true,autoCollectGroups:false,inputMode:'inherit'};
 const origin={provider:'feishu',accountId:'default',conversationId:'chat',messageId:'event',userId:'allowed',kind:'dm',text:'/model p/beta'};
 const signal=new AbortController().signal;
 await runtime.receive(origin,cfg,{},signal);
 await runtime.receive({...origin,text:'/think max'},cfg,{},signal);
 assert.deepEqual(calls.map(x=>x.slice(0,3)),[['command','model','p/beta'],['command','think','max']]);
 assert.deepEqual(await runtime.receive({...origin,userId:'intruder'},cfg,{},signal),{ignored:true});
 assert.equal(calls.length,2);
 runtime.provider='discord';
 await runtime.receive({...origin,provider:'discord'},cfg,{},signal);
 assert.deepEqual(calls.at(-1).slice(0,1),['message']);
 // Discord has no text /model command, so it stays an ordinary message and now
 // carries the local date stamp ahead of the original text.
 assert.match(calls.at(-1)[1],/^\[\d{4}-\d{2}-\d{2} 周[一二三四五六日] \d{2}:\d{2}\] \/model p\/beta$/);
});

test('provider-only shortcut selects exactly one published model and its default effort',async()=>{
 const c={default:{provider:'opencode-go',model:'deepseek-v4.1-flash'},groups:[{id:'opencode-go',name:'OpenCode Go',models:[{id:'deepseek-v4.1-flash',name:'DeepSeek Flash',reasoning:{defaultEffort:'max',efforts:[{id:'max',name:'Max'}]}}]}]};
 const {controller,writes}=host({modelCatalog:async()=>c});
 const response=await channelModelCommand(controller,'session-2','model','opencode-go');
 assert.match(response,/已切换模型：opencode-go\/deepseek-v4\.1-flash/);
 assert.deepEqual(writes,[{sessionId:'session-2',provider:'opencode-go',model:'deepseek-v4.1-flash',reasoningEffort:'max'}]);
});

test('provider-only shortcut with multiple models only lists options and does not mutate the session',async()=>{
 const {controller,writes}=host();
 const response=await channelModelCommand(controller,'session-1','model','p');
 assert.match(response,/2 个可选模型/);
 assert.match(response,/p\/alpha/);assert.match(response,/p\/beta/);
 assert.match(response,/\/model provider\/model/);
 assert.equal(writes.length,0);
 assert.equal((await channelModelCommand(controller,'session-1','model','unknown')).includes('未找到这个提供方'),true);
 assert.equal(writes.length,0);
});

test('empty provider and nested slash IDs resolve through the catalog with no guessing',async()=>{
 const m={groups:[{id:'empty',name:'Empty',models:[]},{id:'siliconflow',name:'SiliconFlow',models:[{id:'BAAI/bge-m3',name:'BGE m3'}]}]};
 const {controller,writes}=host({modelCatalog:async()=>m});
 assert.match(await channelModelCommand(controller,'s1','model','empty'),/没有可用模型/);
 assert.equal(writes.length,0);
 assert.match(await channelModelCommand(controller,'s1','model','siliconflow/BAAI/bge-m3'),/已切换模型/);
 assert.equal(writes[0].model,'BAAI/bge-m3');
});

test('model help is a numbered page, and a number turns it',async()=>{
 const many={groups:[{id:'p',models:Array.from({length:25},(_,i)=>({id:'m-'+i,name:'M'+i}))}]};
 const {controller,writes}=host({modelCatalog:async()=>many});
 const first=await channelModelCommand(controller,'s1','model','');
 assert.match(first,/当前模型：/);
 assert.match(first,/第 1\/3 页 · 共 25 个可对话模型/);
 assert.match(first,/1\. p\/m-0/);
 assert.match(first,/10\. p\/m-9/);
 assert.match(first,/翻页：\/model 2/);
 assert(!first.includes('11. '),'only ten entries per page');
 assert(!first.includes('\n- ')&&!first.includes('\n* '),'plain numbered lines, no markdown bullets');
 const second=await channelModelCommand(controller,'s1','model','2');
 assert.match(second,/第 2\/3 页/);
 assert.match(second,/11\. p\/m-10/);
 assert.match(second,/翻页：\/model 3 · \/model 1/);
 assert.equal(writes.length,0,'paging never changes the model');
 assert.match(await channelModelCommand(controller,'s1','model','9'),/页码超出范围/);
 const thinkHost=host();
 const think=await channelModelCommand(thinkHost.controller,'s1','think','');
 assert(think.indexOf('当前推理强度：')<think.indexOf('使用 /think'));
 assert.match(think,/可选强度：\n• off · 关闭/);
});

test('shorthand never changes model when native Host declines the selection',async()=>{
 const c={groups:[{id:'opencode-go',name:'OpenCode Go',models:[{id:'flash',name:'Flash'}]}]};
 const {controller}=host({modelCatalog:async()=>c,selectModel:async()=>{throw new Error('native-denied');}});
 await assert.rejects(channelModelCommand(controller,'s1','model','opencode-go'),/native-denied/);
});