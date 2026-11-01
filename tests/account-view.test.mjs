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

const streaming = (mode = 'progress') => ({ mode, progress: {}, footer: {}, cardEngine: 'patch', finalFormat: 'auto' });

const v1 = { schemaVersion: 1, accountId: 'default', appId: 'cli_one', workspacePath: 'G:\\A', streaming: streaming(), throttleMs: 750, allowedUsers: [] };
const v2 = {
  schemaVersion: 2,
  defaultAccount: 'default',
  accounts: {
    default: { appId: 'cli_one', workspacePath: 'G:\\A', allowedUsers: ['ou_a'], streaming: streaming('off'), throttleMs: 500 },
    second: { appId: 'cli_two', workspacePath: 'G:\\B', enabled: true, streaming: streaming('partial'), throttleMs: 900 },
  },
};

test('v1 files stay single-account and keep their own accountId', () => {
  assert.equal(isMultiAccountConfig(v1), false);
  assert.deepEqual(accountIdsOf(v1), ['default']);
  const view = accountView(fileOf(v1), 'default');
  assert.equal(view.value.appId, 'cli_one');
  assert.equal(view.value.accountId, 'default');
  assert.equal(view.value.streaming.mode, 'progress');
});

test('each account reads only its own settings, display options included', () => {
  const file = fileOf(structuredClone(v2));
  const first = accountView(file, 'default');
  const second = accountView(file, 'second');
  assert.equal(first.value.accountId, 'default');
  assert.equal(first.value.appId, 'cli_one');
  assert.equal(second.value.appId, 'cli_two');
  assert.equal(second.value.workspacePath, 'G:\\B');
  assert.equal(second.value.enabled, true);
  assert.equal(first.value.streaming.mode, 'off', 'the first bot keeps its own display mode');
  assert.equal(second.value.streaming.mode, 'partial', 'the second bot keeps its own');
  assert.equal(first.value.throttleMs, 500);
  assert.equal(second.value.throttleMs, 900);
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

test('a display option edited through a view stays on that account', () => {
  const file = fileOf(structuredClone(v2));
  const first = accountView(file, 'default');
  first.save({ ...first.value, throttleMs: 1200, streaming: streaming('card') }, 'rev-1');
  assert.equal(file.value.accounts.default.throttleMs, 1200);
  assert.equal(file.value.accounts.default.streaming.mode, 'card');
  assert.equal(file.value.accounts.second.throttleMs, 900, 'the other bot keeps its own value');
  assert.equal(file.value.accounts.second.streaming.mode, 'partial');
  assert.equal(file.value.shared, undefined, 'no shared section is written');
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

test('the slice is frozen deeply, so a stray push fails instead of editing the file', () => {
  const file = fileOf(structuredClone(v2));
  const view = accountView(file, 'default');
  assert.throws(() => { view.value.allowedUsers.push('ou_evil'); }, TypeError);
  assert.deepEqual(file.value.accounts.default.allowedUsers, ['ou_a'], 'the stored array is untouched');
  assert.throws(() => { view.value.streaming.mode = 'card'; }, TypeError);
  assert.equal(file.value.accounts.default.streaming.mode, 'off');
});
