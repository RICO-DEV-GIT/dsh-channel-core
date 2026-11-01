import test from 'node:test';
import assert from 'node:assert/strict';
import { schema, isMultiAccount, migrateToMultiAccount, nextAccountId } from '../channels/feishu/config.js';

const v1 = () => schema.validate({ enabled: true, appId: 'cli_one', workspacePath: 'G:\\DSWork' });

test('the v0.8 single-account shape is still valid and unchanged', () => {
  const value = v1();
  assert.equal(isMultiAccount(value), false);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.appId, 'cli_one');
  assert.equal(value.enabled, true);
  assert.equal(value.workspacePath, 'G:\\DSWork');
});

test('promoting a v1 config keeps every field, display options included', () => {
  const promoted = migrateToMultiAccount(v1(), { accountId: 'default' });
  assert.equal(isMultiAccount(promoted), true);
  assert.equal(promoted.schemaVersion, 2);
  assert.equal(promoted.defaultAccount, 'default');
  assert.equal(promoted.accounts.default.appId, 'cli_one');
  assert.equal(promoted.accounts.default.enabled, true);
  assert.equal(promoted.accounts.default.workspacePath, 'G:\\DSWork');
  assert.equal(promoted.accounts.default.throttleMs, 750, 'throttle belongs to the bot');
  assert.equal(promoted.accounts.default.streaming.mode, 'progress', 'display options belong to the bot');
  assert.equal(promoted.shared, undefined, 'no shared section is written any more');
});

test('a v2 object validates, defaults the default account and freezes accounts', () => {
  const value = schema.validate({
    schemaVersion: 2,
    accounts: {
      first: { appId: 'cli_a', workspacePath: 'G:\\A' },
      second: { appId: 'cli_b', workspacePath: 'G:\\B', enabled: true },
    },
  });
  assert.equal(value.defaultAccount, 'first');
  assert.deepEqual(Object.keys(value.accounts), ['first', 'second']);
  assert.equal(value.accounts.second.enabled, true);
  assert.equal(value.accounts.first.enabled, false, 'account defaults apply');
  assert.throws(() => { value.accounts.first.appId = 'mutated'; }, /read only|not extensible|Cannot assign/i);
});

test('v2 rejects the shapes that would make accounts ambiguous', () => {
  const base = { schemaVersion: 2, accounts: { a: { appId: 'cli_a' } } };
  // Zero accounts is a legal state (the page shows "no bots yet").
  const empty = schema.validate({ schemaVersion: 2, accounts: {} });
  assert.deepEqual(Object.keys(empty.accounts), []);
  assert.equal(empty.defaultAccount, '');
  assert.throws(() => schema.validate({ ...base, defaultAccount: 'missing' }), /默认账号不存在/);
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: { 'bad id': { appId: 'x' } } }), /账号 ID/);
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: { a: { appId: 'x', unknown: 1 } } }), /未知的账号配置项/);
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: { a: { domain: 'weibo' } } }), /账号配置项无效/);
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: { a: { throttleMs: 99999 } } }), /throttleMs/);
});

test('display options belong to each bot', () => {
  const value = schema.validate({
    schemaVersion: 2,
    accounts: {
      a: { appId: 'cli_a', streaming: { mode: 'off' } },
      b: { appId: 'cli_b', streaming: { mode: 'partial' }, throttleMs: 800 },
    },
  });
  assert.equal(value.accounts.a.streaming.mode, 'off');
  assert.equal(value.accounts.b.streaming.mode, 'partial');
  assert.equal(value.accounts.b.throttleMs, 800);
  assert.equal(value.accounts.a.throttleMs, 750, 'the other bot keeps the default cadence');
});

test('a legacy shared section is folded into the accounts on read', () => {
  const value = schema.validate({
    schemaVersion: 2,
    accounts: { a: { appId: 'cli_a' }, b: { appId: 'cli_b', throttleMs: 900 } },
    shared: { streaming: { mode: 'off' }, throttleMs: 500 },
  });
  assert.equal(value.accounts.a.streaming.mode, 'off', 'the legacy value is not lost');
  assert.equal(value.accounts.a.throttleMs, 500);
  assert.equal(value.accounts.b.throttleMs, 900, 'an explicit value wins over shared');
  assert.equal(value.shared, undefined, 'the section is not carried forward');
});

test('account ids are generated without collisions', () => {
  assert.equal(nextAccountId({}), 'default');
  assert.equal(nextAccountId({ default: {} }), 'account-2');
  assert.equal(nextAccountId({ default: {}, 'account-2': {} }), 'account-3');
});
