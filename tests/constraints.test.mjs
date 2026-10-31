import test from 'node:test';
import assert from 'node:assert/strict';
import { accountOwningBot, credentialRefFor, addAccount, removeAccount } from '../lib/accounts.js';
import { assertWorkspaceDisjoint, workspaceOverlap } from '../lib/workspace-scope.js';

const base = () => ({
  schemaVersion: 2,
  defaultAccount: 'bot-1',
  accounts: {
    'bot-1': { appId: 'cli_one', workspacePath: 'G:\\A', appSecretRef: 'FEISHU_APP_SECRET' },
    'bot-2': { appId: 'cli_two', workspacePath: 'G:\\B', appSecretRef: 'FEISHU_APP_SECRET_BOT_2' },
  },
  shared: { throttleMs: 750 },
});

test('the same bot is detected across accounts and refused by name', () => {
  const accounts = base().accounts;
  assert.equal(accountOwningBot(accounts, 'cli_two', 'bot-3'), 'bot-2');
  assert.equal(accountOwningBot(accounts, 'cli_two', 'bot-2'), null, 'its own account is not a conflict');
  assert.equal(accountOwningBot(accounts, 'cli_new', 'bot-3'), null);
  assert.equal(accountOwningBot(accounts, '', 'bot-3'), null, 'an empty app id is never a match');
});

test('the credential name for a new bot is derived from its account id', () => {
  assert.equal(credentialRefFor('bot-2'), 'FEISHU_APP_SECRET_BOT_2');
  assert.equal(credentialRefFor('work-2'), 'FEISHU_APP_SECRET_WORK_2');
});

test('the workspace rules hold for every door: create, bind, save', () => {
  // create: addAccount refuses an overlapping or empty path
  const withTwo = base();
  assert.throws(() => addAccount(withTwo, { workspacePath: 'G:\\A\\inner' }), /重叠/);
  assert.throws(() => addAccount(withTwo, { workspacePath: '' }), /请先为该账号选择工作区/);
  // bind/save: the same pure check the RPC layer now calls before writing
  const saved = { ...withTwo.accounts, 'bot-2': { ...withTwo.accounts['bot-2'], workspacePath: 'g:\\a' } };
  assert.equal(assertWorkspaceDisjoint(saved, 'bot-2').ok, false);
  assert.equal(assertWorkspaceDisjoint(saved, 'bot-2').code, 'workspace-overlap');
  // a sibling with no workspace blocks the others (never allowed once there are two)
  const empty = { ...withTwo.accounts, 'bot-2': { ...withTwo.accounts['bot-2'], workspacePath: '' } };
  assert.equal(assertWorkspaceDisjoint(empty, 'bot-1').code, 'workspace-required');
  // siblings are fine
  assert.equal(assertWorkspaceDisjoint(base().accounts, 'bot-1').ok, true);
});

test('deleting a bot keeps its sibling intact', () => {
  const { value, removed } = removeAccount(base(), 'bot-2');
  assert.equal(removed.appId, 'cli_two');
  assert.equal(value.accounts['bot-1'].appId, 'cli_one');
  assert.equal(value.defaultAccount, 'bot-1');
  assert.equal(workspaceOverlap(value.accounts['bot-1'].workspacePath, 'G:\\B'), false);
});
