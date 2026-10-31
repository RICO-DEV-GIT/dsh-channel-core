import test from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../config.js';
import { createTransport, plainFinalText } from '../transport.js';

const origin = { provider: 'feishu', accountId: 'default', conversationId: 'chat-test', userId: 'user-test', messageId: 'message-test' };

function fixture(streaming = { mode: 'progress' }) {
  const calls = [], listeners = new Map();
  const channel = {
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    async send(chatId, body, options) { calls.push({ type: 'send', chatId, body, options }); return { messageId: 'msg-' + calls.filter(c => c.type === 'send').length }; },
    async updateCard(id, payload) { calls.push({ type: 'update', id, payload }); },
    async recallMessage(id) { calls.push({ type: 'recall', id }); },
    async connect() {}, async disconnect() {},
  };
  const sdk = { createLarkChannel: () => channel, Domain: { Lark: 'lark', Feishu: 'feishu' } };
  const create = () => createTransport({ config: schema.validate({ streaming }), credentials: ['fixture'], signal: new AbortController().signal, receive: async () => {}, state: () => {}, action: async () => {} }, sdk);
  return { calls, create };
}

test('the final answer format defaults to auto: private chat text, group card', () => {
  assert.equal(schema.defaults.streaming.finalFormat, 'auto');
  assert.equal(schema.validate({ streaming: { mode: 'progress' } }).streaming.finalFormat, 'auto');
  assert.equal(schema.validate({ streaming: { finalFormat: 'text' } }).streaming.finalFormat, 'text');
  assert.equal(schema.validate({ streaming: { finalFormat: 'card' } }).streaming.finalFormat, 'card');
  assert.throws(() => schema.validate({ streaming: { finalFormat: 'html' } }));
});

test('plain text keeps the answer and appends the footer as its own paragraph', () => {
  assert.equal(plainFinalText({ text: '第一行\n第二行  ', footerText: '' }), '第一行\n第二行');
  assert.equal(plainFinalText({ text: '答案', footerText: '模型 gpt · 12%' }), '答案\n\n模型 gpt · 12%');
  assert.equal(plainFinalText({}), '');
});

test('text mode sends the answer as a normal message and recalls the progress card', async () => {
  const f = fixture({ mode: 'progress', finalFormat: 'text' });
  const t = await f.create();
  try {
    // A live progress card exists for this conversation.
    await t.progress(origin, { text: '', status: 'generating', final: false }, []);
    const sent = await t.send(origin, { text: '很长的回答'.repeat(400), status: 'completed', final: true });
    assert(sent?.messageId);
    const sends = f.calls.filter(call => call.type === 'send');
    const last = sends[sends.length - 1];
    assert.equal(typeof last.body.text, 'string', 'the final answer is a text message');
    assert(!last.body.card, 'text mode sends no final card');
    assert(last.body.text.includes('很长的回答'));
    assert(f.calls.some(call => call.type === 'recall'), 'the stale progress card is recalled');
  } finally { await t.close(); }
});

test('text mode splits a long answer into screen-sized messages without losing text', async () => {
  const f = fixture({ mode: 'progress', finalFormat: 'text' });
  const t = await f.create();
  try {
    const answer = Array.from({ length: 20 }, (_, index) => `第${index + 1}段：` + '内容'.repeat(80)).join('\n\n');
    await t.send({ ...origin, kind: 'dm' }, { text: answer, status: 'completed', final: true });
    const sends = f.calls.filter(call => call.type === 'send');
    assert(sends.length > 1, 'a long answer becomes several messages');
    assert(sends.every(call => call.body.text.length <= 600), 'each message fits about one phone screen');
    assert.equal(sends.map(call => call.body.text).join('\n\n'), answer);
  } finally { await t.close(); }
});

test('text mode never touches the card path when the answer is empty', async () => {
  const f = fixture({ mode: 'progress', finalFormat: 'text' });
  const t = await f.create();
  try {
    await assert.rejects(async () => t.send(origin, { text: '   ', status: 'completed', final: true }), /feishu-final-text-empty/);
  } finally { await t.close(); }
});

test('card mode keeps sending the final as a card', async () => {
  const f = fixture({ mode: 'progress', finalFormat: 'card' });
  const t = await f.create();
  try {
    const sent = await t.send(origin, { text: '答案', status: 'completed', final: true });
    assert(sent?.messageId);
    const sends = f.calls.filter(call => call.type === 'send');
    assert.equal(typeof sends[sends.length - 1].body.card, 'object', 'card mode is unchanged');
  } finally { await t.close(); }
});

test('auto mode delivers a private chat answer as a selectable text message', async () => {
  const f = fixture({ mode: 'progress' });
  const t = await f.create();
  try {
    await t.progress({ ...origin, kind: 'dm' }, { text: '', status: 'generating', final: false }, []);
    const sent = await t.send({ ...origin, kind: 'dm' }, { text: '私聊回答', status: 'completed', final: true });
    assert(sent?.messageId);
    const last = f.calls.filter(call => call.type === 'send').at(-1);
    assert.equal(typeof last.body.text, 'string', 'a private chat gets a text message');
    assert(!last.body.card, 'no final card is sent to a private chat');
    assert(last.body.text.includes('私聊回答'));
    assert(f.calls.some(call => call.type === 'recall'), 'the progress card is recalled');
  } finally { await t.close(); }
});

test('auto mode keeps the card in a group, where the answer is not read on a phone alone', async () => {
  const f = fixture({ mode: 'progress' });
  const t = await f.create();
  try {
    const sent = await t.send({ ...origin, kind: 'group' }, { text: '群回答', status: 'completed', final: true });
    assert(sent?.messageId);
    const last = f.calls.filter(call => call.type === 'send').at(-1);
    assert.equal(typeof last.body.card, 'object', 'a group keeps the answer card');
    assert(!last.body.text, 'no plain duplication of the same answer');
  } finally { await t.close(); }
});
