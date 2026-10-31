/**
 * Workspace isolation for multi-account channels.
 *
 * Two bot accounts must not share a workspace, otherwise sessions of one bot
 * could be created inside the other bot's project tree. "Overlap" here means
 * equal paths, or one being an ancestor of the other: `G:\Work` and
 * `G:\Work\bot2` are equally invalid, because the inner one lives in the outer
 * one's tree.
 */
import path from 'node:path';

/** Normalise for comparison: absolute, resolved, case-folded on Windows. */
export function normalizeWorkspace(target) {
  const value = String(target ?? '').trim();
  if (!value) return '';
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** True when `a` and `b` are the same directory or one contains the other. */
export function workspaceOverlap(a, b) {
  const left = normalizeWorkspace(a);
  const right = normalizeWorkspace(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const separator = path.sep;
  const withTail = value => (value.endsWith(separator) ? value : value + separator);
  return withTail(left).startsWith(withTail(right)) || withTail(right).startsWith(withTail(left));
}

/** True only when both resolve to the very same directory. */
export function workspaceEquals(a, b) {
  const left = normalizeWorkspace(a);
  const right = normalizeWorkspace(b);
  return Boolean(left) && left === right;
}

/**
 * Check one account against all others.
 *
 * Only an *identical* directory is refused. Nesting is allowed on purpose: the
 * product now assigns every bot its own folder under one base directory
 * (G:\DSWork\<bot>), and those paths are by definition inside one another. DSH
 * scopes Sessions by the full path, so distinct nested paths stay distinct.
 * @returns {{ ok: true } | { ok: false, code: string, conflict?: string }}
 */
export function assertWorkspaceDisjoint(accounts, selfId) {
  const entries = Object.entries(accounts ?? {}).filter(([id]) => id !== selfId);
  const mine = accounts?.[selfId]?.workspacePath ?? '';
  if (!String(mine).trim()) {
    // A single account may inherit the DSH default workspace; with siblings it
    // must be explicit, otherwise two bots silently share one tree.
    if (entries.length > 0) return { ok: false, code: 'workspace-required' };
    return { ok: true };
  }
  for (const [id, other] of entries) {
    if (!String(other?.workspacePath ?? '').trim()) return { ok: false, code: 'workspace-required', conflict: id };
    if (workspaceEquals(mine, other.workspacePath)) return { ok: false, code: 'workspace-overlap', conflict: id };
  }
  return { ok: true };
}
