import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceToRemove } from '../lib/accounts.js';

const derived = 'G:\\DSWork\\cli_aaa';
const sibling = 'G:\\DSWork\\cli_bbb';

test('the folder this plugin derived for the bot may be removed', () => {
  assert.equal(workspaceToRemove({ used: 'G:\\DSWork\\cli_aaa', derived, siblings: [sibling] }), 'G:\\DSWork\\cli_aaa');
  // Windows paths differ in case and separators; the comparison ignores both.
  assert.equal(workspaceToRemove({ used: 'g:/dswork/cli_aaa', derived, siblings: [sibling] }), 'g:/dswork/cli_aaa');
});

test('a directory the operator chose is never removed', () => {
  assert.equal(workspaceToRemove({ used: 'D:\\Projects\\my-bot', derived, siblings: [sibling] }), null);
  assert.equal(workspaceToRemove({ used: 'D:\\Projects\\my-bot', derived: '', siblings: [] }), null);
  assert.equal(workspaceToRemove({ used: '', derived, siblings: [] }), null);
});

test('a folder another bot still uses is kept', () => {
  assert.equal(workspaceToRemove({ used: 'G:\\DSWork\\cli_aaa', derived, siblings: ['g:\\dswork\\cli_aaa'] }), null);
});

test('unrelated siblings do not block the removal', () => {
  assert.equal(workspaceToRemove({ used: derived, derived, siblings: ['', sibling, null] }), derived);
});
