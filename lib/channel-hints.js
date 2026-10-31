/**
 * Turn a channel failure into something the settings page and the chat card can
 * show as an instruction. A raw code like `agent-preset/not-found` tells an
 * operator nothing; every entry here says what to change and where, and the
 * original code stays in parentheses so logs and support reports still match.
 *
 * The hints cover the failures an operator can actually fix (workspace, preset,
 * role, binding) plus the few that only need "send it again". Anything unknown
 * falls back to the old advice with the code appended.
 */
const HINTS = Object.freeze({
  'channel-workspace-required':
    '还没有可用的工作区：在「会话与输入 → 更多会话设置」填写「工作区路径」，或在客户端登记默认工作区',
  'channel-workspace-invalid':
    '工作区路径不存在或不是目录：请修正「工作区路径」为已存在的文件夹',
  'agent-preset/not-found':
    'Agent 预设 ID 在本机不存在：请在「更多会话设置」改成本机已有预设（页面会列出可用项），或留空跟随默认',
  'channel-role-unavailable':
    '指定的角色未登记：请在「指令文件与角色」中检查，或清空「使用角色」',
  'channel-role-workspace-unavailable':
    '角色工作区尚未在 DSH 工作区注册表中登记：请先在客户端登记该目录，或清空「使用角色」',
  'workspace-scope-mismatch':
    '渠道会话的工作区与当前「工作区路径」不一致：请核对路径后重新建立绑定',
  'preset-scope-mismatch':
    '渠道会话的预设与当前「Agent 预设 ID」不一致：请核对预设后重新建立绑定',
  'binding-review-required':
    '共享设置变化影响已有私聊：请在渠道页审阅受影响的会话并明确选择后再应用',
  'receipt-conflict':
    '同一条消息的内容与已记录的不一致：请重新发送，不要重试旧消息',
  'uncertain-input':
    '上一条消息的投递结果未知，为避免重复执行已阻止重试：请稍后在 DSH 中确认结果再发送',
  'aborted-input':
    '渠道连接刚刚切换，这条消息未接收：请重新发送',
  'session-not-owned-by-channel':
    '该会话不属于当前渠道：请用 /session 查看可切换的会话',
  'core-closed':
    '渠道核心已关闭：请重新启用渠道',
  'feishu-answer-card-too-large':
    '回答内容超出飞书卡片上限：请缩短回答或分批发送',
});

/** The machine-readable code carried by a CoreError/RemoteError, if any. */
export function errorCode(error) {
  if (typeof error === 'string') return error.trim();
  const code = error?.code;
  return typeof code === 'string' ? code.trim() : '';
}

/**
 * Human instruction for a failure. `fallback` is used when the code is unknown,
 * so callers keep their previous wording for unexpected errors.
 */
export function channelHint(error, fallback = '请查看渠道设置与 DSH 日志') {
  const code = errorCode(error);
  const hint = HINTS[code];
  if (hint) return `${hint}（${code}）`;
  return code ? `${fallback}（${code}）` : fallback;
}

/** Every hint, for the settings page and tests. */
export function channelHints() {
  return { ...HINTS };
}
