import test from 'node:test';
import assert from 'node:assert/strict';
import { botAppLink, buildBotCard, clearBotCardCache } from '../lib/bot-card.js';

test('bot applink targets the scanned-chat entry point for both domains',()=>{
  assert.equal(botAppLink('feishu','ou_0123456789abcdef'),'https://applink.feishu.cn/client/chat/open?openId=ou_0123456789abcdef');
  assert.equal(botAppLink('lark','ou_0123456789abcdef'),'https://applink.larksuite.com/client/chat/open?openId=ou_0123456789abcdef');
  // Anything that is not a bot open_id is refused rather than encoded into a QR.
  for(const value of ['', 'cli_x', 'ou_', 'ou_ab', 'not-an-id', 'ou_0123\n456', undefined, null, 42])
    assert.throws(()=>botAppLink('feishu',value),/feishu-bot-open-id-invalid/);
  // Only the public id is carried; no credential or token can leak through the link.
  assert(!/app_secret|tenant_access_token|secret=/i.test(botAppLink('feishu','ou_0123456789abcdef')));
});

test('bot card renders a scannable PNG data URL and falls back to a neutral name',async()=>{
  clearBotCardCache();
  const card=await buildBotCard({openId:'ou_0123456789abcdef'},'lark');
  assert.equal(card.openId,'ou_0123456789abcdef');
  assert.equal(card.link,'https://applink.larksuite.com/client/chat/open?openId=ou_0123456789abcdef');
  assert.equal(card.name,'飞书机器人');
  assert.match(card.png,/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  assert(card.png.length>200,'QR payload must contain real pixels');
});

test('bot card keeps the SDK-provided name and reuses the QR for the same id',async()=>{
  clearBotCardCache();
  const first=await buildBotCard({openId:'ou_0123456789abcdef',name:'  管家  '},'feishu');
  const second=await buildBotCard({openId:'ou_0123456789abcdef',name:'管家'},'feishu');
  assert.equal(first.name,'管家');
  assert.equal(second.name,'管家');
  assert.equal(first.png,second.png,'the same link reuses the cached QR');
  const moved=await buildBotCard({openId:'ou_fedcba9876543210',name:'另一个机器人'},'feishu');
  assert.notEqual(moved.png,first.png,'a different bot gets a different QR');
});
