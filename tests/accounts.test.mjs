import test from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, removeAccount, promote, credentialUnusedAfterRemoval, AccountError } from '../lib/accounts.js';

const v1 = () => ({
  schemaVersion: 1, enabled: true, accountId: 'default', appId: 'cli_one', appSecretRef: 'FEISHU_APP_SECRET',
  workspacePath: 'G:\\A', streaming: { mode: 'progress' }, throttleMs: 750, allowedUsers: [],
});
const v2 = () => promote(v1());

test('adding the first extra account promotes the v1 file and keeps the existing bot', () => {
  const { value, accountId, workspacePath } = addAccount(v1(), { appId: 'cli_new_bot' });
  assert.equal(accountId, 'account-2');
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.accounts.default.appId, 'cli_one', 'the existing bot survives the promotion');
  assert.equal(workspacePath, 'G:\\DSWork\\cli_new_bot', 'the workspace is derived from the App ID');
  assert.equal(value.accounts['account-2'].workspacePath, workspacePath);
  assert.equal(value.accounts['account-2'].enabled, false, 'a new account waits for its bot instead of connecting empty');
  assert.match(value.accounts['account-2'].appSecretRef, /^FEISHU_APP_SECRET_ACCOUNT_2$/);
  assert.equal(value.shared.throttleMs, 750);
});

test('a sibling without a workspace is named when it blocks a new account', () => {
  const bare = { ...v1(), workspacePath: '' };
  assert.throws(() => addAccount(bare, { appId: 'cli_new_bot' }), err => {
    assert.equal(err.code, 'workspace-required');
    assert.match(err.message, /机器人「default」/);
    return true;
  });
});

test('adding a bot without an App ID is refused: the id defines the folder', () => {
  assert.throws(() => addAccount(v1(), {}), err => {
    assert.equal(err.code, 'workspace-required');
    assert.match(err.message, /工作区由 App ID 决定/);
    return true;
  });
});

test('an identical workspace is refused and names the conflicting account', () => {
  const withTwo = addAccount(v1(), { appId: 'cli_new_bot' }).value;
  // Point the new account at the existing bot's folder by hand and re-add it.
  withTwo.accounts['account-2'].workspacePath = 'g:\\a';
  assert.throws(() => addAccount(withTwo, { appId: 'cli_third', workspacePath: 'G:\\A' }), /同一个工作区/);
});

test('adding twice with the same id is refused', () => {
  const first = addAccount(v1(), { appId: 'cli_new_bot' });
  assert.throws(() => addAccount(first.value, { appId: 'cli_other', accountId: 'account-2' }), /账号已存在/);
});

test('removing an account fixes the default and reports what went away', () => {
  const withTwo = addAccount(v1(), { appId: 'cli_new_bot' }).value;
  const { value, removed } = removeAccount(withTwo, 'default');
  assert.equal(removed.appId, 'cli_one');
  assert.deepEqual(Object.keys(value.accounts), ['account-2']);
  assert.equal(value.defaultAccount, 'account-2', 'the default moves to the survivor');
});

test('every bot can be removed, including the last one', () => {
  const withTwo = addAccount(v1(), { workspacePath: 'G:\\B' }).value;
  const one = removeAccount(withTwo, 'account-2').value;
  const none = removeAccount(one, 'default').value;
  assert.deepEqual(none.accounts, {});
  assert.equal(none.defaultAccount, '', 'no default is kept when nothing is left');
  assert.throws(() => removeAccount(v1(), 'default'), /只有一个机器人/);
});

test('removing an unknown account is an error, not a silent no-op', () => {
  const withTwo = addAccount(v1(), { workspacePath: 'G:\\B' }).value;
  assert.throws(() => removeAccount(withTwo, 'ghost'), /机器人不存在/);
});

test('a credential is only discarded when no other account uses it', () => {
  const withTwo = addAccount(v1(), { workspacePath: 'G:\\B' }).value;
  withTwo.accounts['account-2'].appSecretRef = 'FEISHU_APP_SECRET';
  assert.equal(credentialUnusedAfterRemoval(withTwo, 'FEISHU_APP_SECRET'), false, 'still referenced');
  withTwo.accounts['account-2'].appSecretRef = 'FEISHU_APP_SECRET_2';
  const after = removeAccount(withTwo, 'account-2').value;
  assert.equal(credentialUnusedAfterRemoval(after, 'FEISHU_APP_SECRET_2'), true);
});

test('AccountError carries a code the RPC layer can forward', () => {
  const error = new AccountError('last-account', '至少需要保留一个账号');
  assert.equal(error.name, 'AccountError');
  assert.equal(error.code, 'last-account');
});
