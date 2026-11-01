/**
 * Diagnostics for /model card taps.
 *
 * Card failures were being diagnosed by guesswork because the only evidence was a toast
 * on someone else's phone. Every model-card tap now records what actually happened —
 * whether a callback arrived, the token it carried, whether the message was known, and
 * what the card update did — and `模`/`/model probe` prints the ring for the operator.
 *
 * A ring buffer, not a log: this is evidence for the next report, kept in memory only.
 */
const MAX = 20;
const ring = [];
/** Whether the Feishu long connection is up. Feishu says "目标回调服务当前未在线" when it is not. */
let connection = '未知';

export function recordModelCardTap(entry) {
  ring.push({ at: new Date().toISOString(), ...entry });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

/** Called by the transport when the long connection opens or closes. */
export function recordConnection(state) {
  connection = state;
}

export function modelCardDiagnostics() {
  return ring.slice();
}

export function clearModelCardDiagnostics() {
  ring.length = 0;
}

/** One-line-per-tap summary, short enough to read in a chat bubble. */
export function describeModelCardDiagnostics() {
  const head = '通道：' + connection + '\n';
  if (!ring.length) {
    return head + '\n诊断：还没有记录到任何卡片点击。\n\n说明：如果刚点过按钮却没到这条记录，说明按钮没有触发回调（或长连接不在线）。';
  }
  const lines = ring.map((entry, index) => {
    const parts = [
      index + 1 + '.',
      entry.token ?? '(无 token)',
      '已知卡片=' + (entry.registered === false ? '否' : '是'),
    ];
    if (entry.formKeys) parts.push('表单=' + entry.formKeys);
    if (entry.modelValue) parts.push('值=' + entry.modelValue);
    if (entry.outcome) parts.push('结果=' + entry.outcome);
    return parts.join(' ');
  });
  return head + '诊断（最近 ' + ring.length + ' 次卡片点击）：\n' + lines.join('\n');
}
