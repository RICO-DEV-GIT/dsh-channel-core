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
    async connect() {}, async disconnect() {},
  };
  const sdk = { createLarkChannel: () => channel, Domain: { Lark: 'lark', Feishu: 'feishu' } };
  const create = () => createTransport({
    config: schema.validate({ streaming: { mode: 'off' } }), credentials: ['fixture'],
    signal: new AbortController().signal, receive: async () => {}, state: () => {}, action: async () => ({ completed: false }),
    host,
  }, sdk);
  return { calls, listeners, create };
}

const tapModel = async (listeners, values, token = 'dsh:model:apply', messageId = 'card-1') => {
  const handler = listeners.get('cardAction');
  return handler({ messageId, chatId: origin.conversationId, operator: { openId: origin.userId }, action: { value: { dsh: token } }, raw: { action: { form_value: values } } });
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

test('a tap re-renders the card for the Session the card belongs to', async () => {
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
    const reply = await tapModel(f.listeners, { dsh_provider: 'ark', dsh_model: 'ark/model-x' });
    assert.deepEqual(seen, [{ sessionId: 'session-a', action: { kind: 'apply', provider: 'ark', model: 'ark/model-x' } }]);
    assert.equal(reply.toast.content, '已切换模型');
    const update = f.calls.find(call => call.type === 'update');
    assert.equal(update.id, 'card-1');
    assert.deepEqual(update.payload, card);
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
