import test from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, removeAccount, promote, credentialUnusedAfterRemoval, AccountError } from '../lib/accounts.js';

const v1 = () => ({
  schemaVersion: 1, enabled: true, accountId: 'default', appId: 'cli_one', appSecretRef: 'FEISHU_APP_SECRET',
  workspacePath: 'G:\\A', streaming: { mode: 'progress' }, throttleMs: 750, allowedUsers: [],
});
const v2 = () => promote(v1());

test('adding the first extra account promotes the v1 file and keeps the existing bot', () => {
  const { value, accountId } = addAccount(v1(), { workspacePath: 'G:\\B' });
  assert.equal(accountId, 'account-2');
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.accounts.default.appId, 'cli_one', 'the existing bot survives the promotion');
  assert.equal(value.accounts['account-2'].workspacePath, 'G:\\B');
  assert.equal(value.accounts['account-2'].enabled, false, 'a new account waits for its bot instead of connecting empty');
  assert.match(value.accounts['account-2'].appSecretRef, /^FEISHU_APP_SECRET_ACCOUNT_2$/);
  assert.equal(value.shared.throttleMs, 750);
});

test('a sibling without a workspace is named when it blocks a new account', () => {
  const bare = { ...v1(), workspacePath: '' };
  assert.throws(() => addAccount(bare, { workspacePath: 'G:\\B' }), err => {
    assert.equal(err.code, 'workspace-required');
    assert.match(err.message, /账号「default」/);
    return true;
  });
});

test('an account without a workspace is refused before anything is written', () => {
  assert.throws(() => addAccount(v1(), { workspacePath: '   ' }), err => {
    assert.equal(err.code, 'workspace-required');
    assert.match(err.message, /请先为该账号选择工作区/);
    return true;
  });
});

test('overlapping workspaces are refused and name the conflicting account', () => {
  assert.throws(() => addAccount(v1(), { workspacePath: 'G:\\A\\inner' }), err => {
    assert.equal(err.code, 'workspace-overlap');
    assert.match(err.message, /default/);
    return true;
  });
  assert.throws(() => addAccount(v1(), { workspacePath: 'g:\\a' }), /重叠/);
});

test('adding twice with the same id is refused', () => {
  const first = addAccount(v1(), { workspacePath: 'G:\\B' });
  assert.throws(() => addAccount(first.value, { workspacePath: 'G:\\C', accountId: 'account-2' }), /账号已存在/);
});

test('removing an account fixes the default and reports what went away', () => {
  const withTwo = addAccount(v1(), { workspacePath: 'G:\\B' }).value;
  const { value, removed } = removeAccount(withTwo, 'default');
  assert.equal(removed.appId, 'cli_one');
  assert.deepEqual(Object.keys(value.accounts), ['account-2']);
  assert.equal(value.defaultAccount, 'account-2', 'the default moves to the survivor');
});

test('the last account cannot be removed', () => {
  const withTwo = addAccount(v1(), { workspacePath: 'G:\\B' }).value;
  const one = removeAccount(withTwo, 'account-2').value;
  assert.throws(() => removeAccount(one, 'default'), /至少需要保留一个账号/);
  assert.throws(() => removeAccount(v1(), 'default'), /只有一个账号/);
});

test('removing an unknown account is an error, not a silent no-op', () => {
  const withTwo = addAccount(v1(), { workspacePath: 'G:\\B' }).value;
  assert.throws(() => removeAccount(withTwo, 'ghost'), /账号不存在/);
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
