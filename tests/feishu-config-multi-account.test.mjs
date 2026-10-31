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

test('promoting a v1 config keeps every field and moves display options to shared', () => {
  const promoted = migrateToMultiAccount(v1(), { accountId: 'default' });
  assert.equal(isMultiAccount(promoted), true);
  assert.equal(promoted.schemaVersion, 2);
  assert.equal(promoted.defaultAccount, 'default');
  assert.equal(promoted.accounts.default.appId, 'cli_one');
  assert.equal(promoted.accounts.default.enabled, true);
  assert.equal(promoted.accounts.default.workspacePath, 'G:\\DSWork');
  assert.equal(promoted.shared.throttleMs, 750);
  assert.equal(promoted.shared.streaming.mode, 'progress');
  assert.equal(promoted.accounts.default.streaming, undefined, 'streaming lives in shared only');
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
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: {} }), /至少需要配置一个机器人账号/);
  assert.throws(() => schema.validate({ ...base, defaultAccount: 'missing' }), /默认账号不存在/);
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: { 'bad id': { appId: 'x' } } }), /账号 ID/);
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: { a: { appId: 'x', unknown: 1 } } }), /未知的账号配置项/);
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: { a: { domain: 'weibo' } } }), /账号配置项无效/);
  assert.throws(() => schema.validate({ schemaVersion: 2, accounts: { a: {} }, shared: { throttleMs: 99999 } }), /shared.throttleMs/);
});

test('an account may not carry shared display options', () => {
  // Silently dropping them would let an operator believe a per-account setting
  // took effect; both keys belong to `shared`.
  assert.throws(
    () => schema.validate({ schemaVersion: 2, accounts: { a: { appId: 'x', streaming: { mode: 'off' } } } }),
    /不能单独设置 streaming/,
  );
  assert.throws(
    () => schema.validate({ schemaVersion: 2, accounts: { a: { appId: 'x', throttleMs: 800 } } }),
    /不能单独设置 throttleMs/,
  );
});

test('account ids are generated without collisions', () => {
  assert.equal(nextAccountId({}), 'default');
  assert.equal(nextAccountId({ default: {} }), 'account-2');
  assert.equal(nextAccountId({ default: {}, 'account-2': {} }), 'account-3');
});
