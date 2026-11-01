import test from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../config.js';
import { createTransport } from '../transport.js';

const origin = { provider: 'feishu', accountId: 'default', conversationId: 'chat-test', userId: 'user-test', messageId: 'message-test' };
const card = { schema: '2.0', header: { title: { tag: 'plain_text', content: '切换模型' } }, body: { elements: [{ tag: 'markdown', content: '当前模型：x' }] } };

function fixture(host) {
  const calls = [], listeners = new Map();
  const channel = {
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    async send(chatId, body, options) { calls.push({ type: 'send', chatId, body, options }); return { messageId: 'card-' + calls.filter(c => c.type === 'send').length }; },
    async updateCard(id, payload) { calls.push({ type: 'update', id, payload }); },
    async recallMessage(id) { calls.push({ type: 'recall', id }); },
    async connect() {}, async disconnect() {},
  };
  const sdk = { createLarkChannel: () => channel, Domain: { Lark: 'lark', Feishu: 'feishu' } };
  const create = () => createTransport({
    config: schema.validate({ streaming: { mode: 'off' } }), credentials: ['fixture'],
    signal: new AbortController().signal, receive: async () => {}, state: () => {}, action: async () => ({ completed: false }),
    host,
  }, sdk);
  return { calls, listeners, channel, create };
}

const tapModel = async (listeners, values, token = 'dsh:model:apply', messageId = 'card-1', formValues = values) => {
  const handler = listeners.get('cardAction');
  return handler({ messageId, chatId: origin.conversationId, operator: { openId: origin.userId }, action: { value: { dsh: token } }, raw: { action: { form_value: formValues } } });
};

test('a picker card is sent as an interactive card and remembered for taps', async () => {
  const f = fixture({});
  const t = await f.create();
  try {
    const sent = await t.send(origin, { feishuModelCard: { card, sessionId: 'session-a' }, text: '当前模型：…', status: 'completed', final: true });
    assert.equal(sent.messageId, 'card-1');
    const send = f.calls.find(call => call.type === 'send');
    assert.deepEqual(send.body.card, card, 'the card is sent verbatim');
  } finally { await t.close(); }
});

test('a tap posts the new card and recalls the old one', async () => {
  const seen = [];
  const f = fixture({
    modelPicker: async request => {
      seen.push(request);
      return { card, toast: { type: 'success', content: '已切换模型' } };
    },
  });
  const t = await f.create();
  try {
    await t.send(origin, { feishuModelCard: { card, sessionId: 'session-a' }, text: 'x', status: 'completed', final: true });
    await tapModel(f.listeners, { dsh_provider: 'ark', dsh_model: 'ark/model-x' });
    assert.deepEqual(seen, [{ sessionId: 'session-a', action: { kind: 'apply', provider: 'ark', model: 'ark/model-x' } }]);
    // patching answered 200 but the client kept the old card, so a tap posts a fresh card
    // and recalls the old one.
    const cards = f.calls.filter(call => call.type === 'send' && call.body?.card);
    assert.equal(cards.length, 2, 'original card + the new one');
    assert.deepEqual(f.calls.find(call => call.type === 'recall'), { type: 'recall', id: 'card-1' });
  } finally { await t.close(); }
});

test('a page tap posts the next page as a fresh card', async () => {
  const f = fixture({ modelPicker: async () => ({ card }) });
  const t = await f.create();
  try {
    await t.send(origin, { feishuModelCard: { card, sessionId: 'session-a' }, text: 'x', status: 'completed', final: true });
    await tapModel(f.listeners, {}, 'dsh:model:page:1', 'card-1');
    const cards = f.calls.filter(call => call.type === 'send' && call.body?.card);
    assert.equal(cards.length, 2, 'the new page is a new card');
    assert.deepEqual(f.calls.find(call => call.type === 'recall'), { type: 'recall', id: 'card-1' });
  } finally { await t.close(); }
});

test('a failed send reports through a message, not a toast', async () => {
  const f = fixture({ modelPicker: async () => ({ card }) });
  const t = await f.create();
  let sends = 0;
  f.channel.send = async (chatId, body, options) => {
    sends += 1;
    if (sends === 2) throw Object.assign(new Error('rejected'), { code: 230099 });
    f.calls.push({ type: 'send', chatId, body, options });
    return { messageId: 'card-' + sends };
  };
  try {
    await t.send(origin, { feishuModelCard: { card, sessionId: 'session-a' }, text: 'x', status: 'completed', final: true });
    await tapModel(f.listeners, { dsh_model: 'ark/model-x' }, 'dsh:model:apply', 'card-1');
    const texts = f.calls.filter(call => call.type === 'send' && call.body?.text).map(call => call.body.text);
    assert.ok(texts.some(text => text.includes('230099')), 'the failure code reaches the operator: ' + JSON.stringify(texts));
  } finally { await t.close(); }
});

test('a tap on a card this transport never sent is reported instead of crashing', async () => {
  const f = fixture({ modelPicker: async () => ({ card, toast: { type: 'success', content: 'ok' } }) });
  const t = await f.create();
  try {
    const reply = await tapModel(f.listeners, { dsh_model: 'ark/x' }, 'dsh:model:apply', 'card-unknown');
    assert.equal(reply.toast.type, 'error');
    assert.match(reply.toast.content, /重新发送 \/model/);
  } finally { await t.close(); }
});

test('a rejected card falls back to the text answer instead of failing /model', async () => {
  const f = fixture({});
  const t = await f.create();
  // Make the card send fail the way Feishu rejects an invalid card.
  f.channel.send = async (chatId, payload) => {
    f.calls.push({ type: 'send', chatId, body: payload });
    if (payload.card) throw Object.assign(new Error('invalid card'), { code: 230099 });
    return { messageId: 'text-1' };
  };
  try {
    const sent = await t.send(origin, { feishuModelCard: { card, sessionId: 'session-a' }, text: '当前模型：p/alpha', status: 'completed', final: true });
    assert.equal(sent.messageId, 'text-1', 'the text answer is delivered');
    const texts = f.calls.filter(call => call.type === 'send').map(call => call.body.text).filter(Boolean);
    assert.equal(texts.length, 1, 'exactly one fallback message is delivered');
    assert.match(texts[0], /当前模型：p\/alpha/);
  } finally { await t.close(); }
});

test('ask-user answers still take the normal path', async () => {
  const answered = [];
  const f = fixture({ });
  const t = await f.create();
  try {
    // Replace the action channel used by Ask User submissions.
    const handler = f.listeners.get('cardAction');
    const reply = await handler({ messageId: 'ask-1', chatId: origin.conversationId, operator: { openId: origin.userId }, action: { value: { dsh: 'dsh:answer:token-1' } }, raw: { action: { form_value: { ask_custom: 'hello' } } } });
    assert.equal(reply.toast.type, 'success');
    assert.deepEqual(answered, [], 'no model picker involvement');
  } finally { await t.close(); }
});
