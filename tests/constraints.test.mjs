import test from 'node:test';
import assert from 'node:assert/strict';
import { accountOwningBot, credentialRefFor, addAccount, removeAccount, resolveWorkspaceBase, joinWorkspace, workspaceFor, FALLBACK_WORKSPACE_DIR } from '../lib/accounts.js';
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

test('the workspace is derived from the App ID, never typed', () => {
  // The only door left: the path is computed, so two bots cannot collide unless the
  // App ID itself is reused (which C4 already refuses).
  const withBot = addAccount(base(), { appId: 'cli_new_bot' });
  assert.equal(withBot.workspacePath, joinWorkspace('G:\\DSWork', 'cli_new_bot'));
  assert.equal(withBot.value.accounts[withBot.accountId].workspacePath, withBot.workspacePath);
  assert.throws(() => addAccount(base(), {}), /App ID 格式不正确/);
  // An identical path is still refused (defence in depth for a hand-edited file).
  const clashing = { ...base().accounts, 'bot-2': { ...base().accounts['bot-2'], workspacePath: 'g:\\a' } };
  assert.equal(assertWorkspaceDisjoint(clashing, 'bot-2').code, 'workspace-overlap');
  // Nesting is allowed: every bot lives under the same root by design.
  assert.equal(assertWorkspaceDisjoint({ 'bot-1': { workspacePath: 'G:\\DSWork' }, 'bot-2': { workspacePath: 'G:\\DSWork\\cli_x' } }, 'bot-2').ok, true);
});

test('the workspace root falls back to <plugin>\\DSWork when G:\\DSWork is missing', async () => {
  const present = await resolveWorkspaceBase({ pluginRoot: 'C:\\plugin', exists: async () => true });
  assert.equal(present, 'G:\\DSWork');
  const missing = await resolveWorkspaceBase({ pluginRoot: 'C:\\plugin', exists: async () => false });
  assert.equal(missing, 'C:\\plugin\\DSWork');
  assert.equal(workspaceFor('C:\\plugin\\DSWork', 'cli_x'), 'C:\\plugin\\DSWork\\cli_x');
  assert.equal(workspaceFor('G:\\DSWork', 'cli_x'), 'G:\\DSWork\\cli_x');
  assert.equal(workspaceFor('G:\\DSWork', ''), '', 'no app id, no workspace');
});

test('deleting a bot keeps its sibling intact', () => {
  const { value, removed } = removeAccount(base(), 'bot-2');
  assert.equal(removed.appId, 'cli_two');
  assert.equal(value.accounts['bot-1'].appId, 'cli_one');
  assert.equal(value.defaultAccount, 'bot-1');
  assert.equal(workspaceOverlap(value.accounts['bot-1'].workspacePath, 'G:\\B'), false);
});
