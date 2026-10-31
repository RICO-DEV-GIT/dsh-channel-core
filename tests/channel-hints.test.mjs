import test from 'node:test';
import assert from 'node:assert/strict';
import { channelHint, errorCode, channelHints } from '../lib/channel-hints.js';

test('every known failure explains what to change and keeps the raw code', () => {
  const preset = channelHint({ code: 'agent-preset/not-found' });
  assert.match(preset, /预设/);
  assert.match(preset, /agent-preset\/not-found/, 'the machine code stays for support reports');
  const workspace = channelHint({ code: 'channel-workspace-required' });
  assert.match(workspace, /工作区/);
  assert.match(workspace, /channel-workspace-required/);
  const scope = channelHint(new Error('x'));
  assert.equal(scope, '请查看渠道设置与 DSH 日志', 'an error without a code keeps the neutral advice');
});

test('unknown codes fall back to the caller wording plus the code', () => {
  const text = channelHint({ code: 'something-new' }, '请检查凭证、权限或网络');
  assert.equal(text, '请检查凭证、权限或网络（something-new）');
  assert.equal(channelHint({ code: 'something-new' }), '请查看渠道设置与 DSH 日志（something-new）');
});

test('error codes are read from the code field or a plain code string', () => {
  assert.equal(errorCode({ code: 'a' }), 'a');
  assert.equal(errorCode(new Error('b')), '', 'a bare message is not a code');
  assert.equal(errorCode('c'), 'c');
  assert.equal(errorCode(undefined), '');
  assert.equal(errorCode({ code: '  d  ' }), 'd');
});

test('the hint table covers the failures an operator can fix', () => {
  const hints = channelHints();
  for (const code of ['channel-workspace-required', 'channel-workspace-invalid', 'agent-preset/not-found', 'workspace-scope-mismatch', 'preset-scope-mismatch', 'binding-review-required', 'receipt-conflict', 'uncertain-input', 'aborted-input']) {
    assert.ok(hints[code], `${code} needs an actionable hint`);
    assert.ok(hints[code].length > 8);
  }
});
