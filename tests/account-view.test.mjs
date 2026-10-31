import test from 'node:test';
import assert from 'node:assert/strict';
import { accountView, accountIdsOf, isMultiAccountConfig } from '../lib/channel-plugin-settings/account-view.js';

function fileOf(value) {
  let current = value;
  const listeners = new Set();
  return {
    get value() { return current; },
    set value(next) { current = next; },
    snapshot() { return { value: current, revision: 'rev-1' }; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    save(next) { current = next; for (const fn of listeners) fn(); return { value: current, revision: 'rev-2' }; },
    listeners,
  };
}

const v1 = { schemaVersion: 1, accountId: 'default', appId: 'cli_one', workspacePath: 'G:\\A', streaming: { mode: 'progress' }, throttleMs: 750, allowedUsers: [] };
const v2 = {
  schemaVersion: 2,
  defaultAccount: 'default',
  accounts: {
    default: { appId: 'cli_one', workspacePath: 'G:\\A', allowedUsers: ['ou_a'] },
    second: { appId: 'cli_two', workspacePath: 'G:\\B', enabled: true },
  },
  shared: { streaming: { mode: 'progress' }, throttleMs: 500 },
};

test('v1 files stay single-account and keep their own accountId', () => {
  assert.equal(isMultiAccountConfig(v1), false);
  assert.deepEqual(accountIdsOf(v1), ['default']);
  const view = accountView(fileOf(v1), 'default');
  assert.equal(view.value.appId, 'cli_one');
  assert.equal(view.value.accountId, 'default');
  assert.equal(view.value.streaming.mode, 'progress');
});

test('a v2 account sees its own slice plus the shared display options', () => {
  const file = fileOf(v2);
  const first = accountView(file, 'default');
  const second = accountView(file, 'second');
  assert.equal(first.value.accountId, 'default');
  assert.equal(first.value.appId, 'cli_one');
  assert.equal(second.value.accountId, 'second');
  assert.equal(second.value.appId, 'cli_two');
  assert.equal(second.value.workspacePath, 'G:\\B');
  assert.equal(second.value.enabled, true);
  assert.deepEqual(first.value.streaming, v2.shared.streaming, 'streaming comes from shared');
  assert.equal(first.value.throttleMs, 500);
  assert.deepEqual(accountIdsOf(v2), ['default', 'second']);
});

test('saving one account never touches the other', () => {
  const file = fileOf(structuredClone(v2));
  const second = accountView(file, 'second');
  second.save({ ...second.value, workspacePath: 'G:\\B2' }, 'rev-1');
  assert.equal(file.value.accounts.second.workspacePath, 'G:\\B2');
  assert.equal(file.value.accounts.default.workspacePath, 'G:\\A', 'the sibling account is untouched');
  assert.equal(file.value.accounts.default.appId, 'cli_one');
});

test('display options written through a view land in shared, not in the account', () => {
  const file = fileOf(structuredClone(v2));
  const first = accountView(file, 'default');
  first.save({ ...first.value, throttleMs: 900, streaming: { mode: 'partial' } }, 'rev-1');
  assert.equal(file.value.shared.throttleMs, 900);
  assert.equal(file.value.shared.streaming.mode, 'partial');
  assert.equal(file.value.accounts.default.throttleMs, undefined, 'not duplicated into the account');
  assert.equal(file.value.accounts.default.streaming, undefined);
});

test('the account id is never written back into a slice', () => {
  const file = fileOf(structuredClone(v2));
  const first = accountView(file, 'default');
  first.save({ ...first.value, appId: 'cli_new' }, 'rev-1');
  assert.equal(file.value.accounts.default.accountId, undefined);
  assert.equal(file.value.accounts.default.appId, 'cli_new');
});

test('subscribers are notified through the view and survive a v1 file', () => {
  const file = fileOf(v1);
  const view = accountView(file, 'default');
  let seen = 0;
  const off = view.subscribe(() => { seen++; });
  file.value = { ...v1, appId: 'cli_two' };
  for (const fn of file.listeners) fn();
  assert.equal(seen, 1);
  assert.equal(view.value.appId, 'cli_two');
  off();
  for (const fn of file.listeners) fn();
  assert.equal(seen, 1, 'unsubscribed');
});

test('an account that disappeared reads as null instead of throwing', () => {
  const file = fileOf(structuredClone(v2));
  const gone = accountView(file, 'third');
  assert.equal(gone.value, null);
  assert.equal(gone.snapshot().value, null);
});
