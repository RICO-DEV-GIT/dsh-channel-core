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

export function recordModelCardTap(entry) {
  ring.push({ at: new Date().toISOString(), ...entry });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

export function modelCardDiagnostics() {
  return ring.slice();
}

export function clearModelCardDiagnostics() {
  ring.length = 0;
}

/** One-line-per-tap summary, short enough to read in a chat bubble. */
export function describeModelCardDiagnostics() {
  if (!ring.length) {
    return '诊断：还没有记录到任何卡片点击。\n\n说明：如果刚点过按钮却没到这条记录，说明按钮没有触发回调。';
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
  return '诊断（最近 ' + ring.length + ' 次卡片点击）：\n' + lines.join('\n');
}
