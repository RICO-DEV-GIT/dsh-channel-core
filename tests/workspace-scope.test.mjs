import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspace, workspaceOverlap, assertWorkspaceDisjoint } from '../lib/workspace-scope.js';

const win = process.platform === 'win32';
const at = value => (win ? value : value.replace(/^[A-Za-z]:\\/u, '/'));
const LEFT = at('G:\\Work');
const RIGHT = at('G:\\Work-bot2');
const INSIDE = at('G:\\Work\\bot2');

test('the same directory overlaps, ignoring case and separators on Windows', () => {
  assert.equal(workspaceOverlap(LEFT, LEFT), true);
  if (win) {
    assert.equal(workspaceOverlap('G:\\Work', 'g:\\work'), true);
    assert.equal(workspaceOverlap('G:\\Work', 'G:\\Work\\'), true);
  }
});

test('a parent and its child overlap in both directions', () => {
  assert.equal(workspaceOverlap(LEFT, INSIDE), true);
  assert.equal(workspaceOverlap(INSIDE, LEFT), true);
});

test('sibling directories with a common prefix do not overlap', () => {
  // The classic false positive: G:\Work vs G:\Work-bot2 share a text prefix but
  // are different trees.
  assert.equal(workspaceOverlap(LEFT, RIGHT), false);
  assert.equal(workspaceOverlap(RIGHT, LEFT), false);
});

test('empty paths never overlap', () => {
  assert.equal(workspaceOverlap('', LEFT), false);
  assert.equal(workspaceOverlap(LEFT, '   '), false);
  assert.equal(normalizeWorkspace(''), '');
});

test('a single account may inherit the default workspace', () => {
  assert.deepEqual(assertWorkspaceDisjoint({ default: { workspacePath: '' } }, 'default'), { ok: true });
});

test('with siblings an empty workspace is refused and named', () => {
  const accounts = { default: { workspacePath: '' }, second: { workspacePath: RIGHT } };
  assert.deepEqual(assertWorkspaceDisjoint(accounts, 'default'), { ok: false, code: 'workspace-required' });
  const inner = { default: { workspacePath: LEFT }, second: { workspacePath: '' } };
  assert.deepEqual(assertWorkspaceDisjoint(inner, 'default'), { ok: false, code: 'workspace-required', conflict: 'second' });
});

test('only an identical workspace is refused, and the conflict is named', () => {
  const same = { default: { workspacePath: LEFT }, second: { workspacePath: LEFT } };
  assert.deepEqual(assertWorkspaceDisjoint(same, 'default'), { ok: false, code: 'workspace-overlap', conflict: 'second' });
  assert.deepEqual(assertWorkspaceDisjoint(same, 'second'), { ok: false, code: 'workspace-overlap', conflict: 'default' });
});

test('nested workspaces are allowed: every bot lives under one root', () => {
  const nested = { default: { workspacePath: LEFT }, second: { workspacePath: INSIDE } };
  assert.deepEqual(assertWorkspaceDisjoint(nested, 'default'), { ok: true });
  assert.deepEqual(assertWorkspaceDisjoint(nested, 'second'), { ok: true });
});

test('disjoint siblings pass', () => {
  const accounts = { default: { workspacePath: LEFT }, second: { workspacePath: RIGHT } };
  assert.deepEqual(assertWorkspaceDisjoint(accounts, 'default'), { ok: true });
  assert.deepEqual(assertWorkspaceDisjoint(accounts, 'second'), { ok: true });
});
