import test from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../config.js';
import { createTransport } from '../transport.js';

const origin = { provider: 'feishu', accountId: 'default', conversationId: 'chat-test', userId: 'user-test', messageId: 'message-test' };

function fixture(channel) {
  const sdk = { createLarkChannel: () => channel, Domain: { Lark: 'lark', Feishu: 'feishu' } };
  return createTransport({
    config: schema.validate({}), credentials: ['fixture'],
    signal: new AbortController().signal, receive: async () => {}, state: () => {}, action: async () => {},
  }, sdk);
}

test('the bot card asks the SDK to fetch the identity when no getter exists', async () => {
  // The shipped SDK exposes setBotIdentity()/fetchBotIdentity() but no public
  // getBotIdentity(); reading that getter was what left the card empty forever.
  let fetches = 0;
  const channel = {
    on() { return () => {}; }, async connect() {}, async disconnect() {},
    async fetchBotIdentity() { fetches++; return { openId: 'ou_0123456789abcdef', name: '管家' }; },
  };
  const t = await fixture(channel);
  try {
    const card = await t.botCard();
    assert(card, 'the card is produced once the identity is fetched');
    assert.equal(card.openId, 'ou_0123456789abcdef');
    assert.equal(card.name, '管家');
    assert.match(card.png, /^data:image\/png;base64,/);
    assert.equal(fetches, 1);
    const again = await t.botCard();
    assert.equal(again.openId, 'ou_0123456789abcdef');
    assert.equal(fetches, 1, 'a resolved identity is cached, not refetched');
  } finally { await t.close(); }
});

test('a failed identity lookup says why instead of showing an empty card', async () => {
  const failing = {
    on() { return () => {}; }, async connect() {}, async disconnect() {},
    async fetchBotIdentity() { throw new Error('missing bot permission'); },
  };
  const t = await fixture(failing);
  try {
    await assert.rejects(() => t.botCard(), /读取机器人身份失败：missing bot permission/,
      'the settings page prints this text, so it must name the cause');
  } finally { await t.close(); }
});

test('a channel that resolves identity lazily still works on a later call', async () => {
  let attempt = 0;
  const channel = {
    on() { return () => {}; }, async connect() {}, async disconnect() {},
    async fetchBotIdentity() {
      attempt++;
      if (attempt === 1) return null;                      // not ready yet
      return { openId: 'ou_fedcba9876543210', name: '第二个机器人' };
    },
  };
  const t = await fixture(channel);
  try {
    assert.equal(await t.botCard(), null, 'not ready yet');
    const card = await t.botCard();
    assert.equal(card.openId, 'ou_fedcba9876543210', 'a later call resolves it');
    assert.equal(attempt, 2);
  } finally { await t.close(); }
});
