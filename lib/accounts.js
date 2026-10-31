/**
 * Account lifecycle for a channel config file.
 *
 * Kept separate from the RPC layer so the config transforms are pure and testable:
 * the caller owns the file, the runtimes and the store, this module only decides
 * what the new config object must look like.
 */
import { isMultiAccount, migrateToMultiAccount, nextAccountId } from '../channels/feishu/config.js';
import { assertWorkspaceDisjoint } from './workspace-scope.js';

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class AccountError extends Error {
  constructor(code, message = code) { super(message); this.name = 'AccountError'; this.code = code; }
}

/** Current accounts as a plain object, promoting a v1 file when needed. */
export function accountsOf(value) {
  if (isMultiAccount(value)) return value.accounts ?? {};
  return null;
}

/** Promote v1 → v2 in memory. The caller persists it. */
export function promote(value, accountId = 'default') {
  if (isMultiAccount(value)) return value;
  return migrateToMultiAccount(value, { accountId });
}

/**
 * Add an account. A v1 file is promoted first, so the first "second bot" also
 * migrates the existing single bot instead of dropping it.
 * @returns {{ value: object, accountId: string }}
 */
export function addAccount(value, { workspacePath = '', accountId, enabled = false, appId = '', appSecretRef } = {}) {
  const base = promote(value);
  const accounts = { ...base.accounts };
  const id = accountId ? String(accountId) : nextAccountId(accounts);
  if (!ACCOUNT_ID.test(id)) throw new AccountError('account-id-invalid', '账号 ID 只能包含字母、数字、下划线和短横线');
  if (Object.hasOwn(accounts, id)) throw new AccountError('account-duplicate', '账号已存在：' + id);
  const path = String(workspacePath ?? '').trim();
  // Every account must own a workspace of its own once there is more than one.
  if (!path) throw new AccountError('workspace-required', '请先为该账号选择工作区');
  const candidate = {
    ...accounts,
    [id]: {
      enabled: enabled === true,
      appId: String(appId ?? ''),
      appSecretRef: String(appSecretRef ?? credentialRefFor(id)),
      domain: 'feishu',
      workspacePath: path,
      allowedUsers: [], allowGroups: false, autoCollectGroups: false, allowedGroups: [], requireMention: true,
      inputMode: 'inherit', agentPreset: '', rolePreset: '', memoryNamespace: 'private', identityLinks: [],
      ownerMode: 'first-dm', ownerUserId: '', attachments: true, maxAttachmentMB: 10,
    },
  };
  const check = assertWorkspaceDisjoint(candidate, id);
  if (!check.ok) {
    // "workspace-required" here always means a *sibling* has no workspace: the
    // new account's own path was checked above. Naming that account is the only
    // way the operator knows what to fix before adding another bot.
    throw new AccountError(check.code, check.code === 'workspace-overlap'
      ? '与账号「' + check.conflict + '」的工作区重叠（或互为父子目录）'
      : '请先为账号「' + check.conflict + '」设置工作区，再新增账号');
  }
  return { value: { ...base, accounts: candidate }, accountId: id };
}

/**
 * Remove an account (config only — the caller stops the runtime and clears the
 * channel records first). The last account cannot be removed.
 * @returns {{ value: object, removed: object }}
 */
export function removeAccount(value, accountId) {
  if (!isMultiAccount(value)) throw new AccountError('account-single', '当前只有一个账号，无法删除');
  const accounts = { ...value.accounts };
  if (!Object.hasOwn(accounts, accountId)) throw new AccountError('account-not-found', '账号不存在：' + accountId);
  if (Object.keys(accounts).length <= 1) throw new AccountError('last-account', '至少需要保留一个账号');
  const removed = accounts[accountId];
  delete accounts[accountId];
  const defaultAccount = value.defaultAccount === accountId ? Object.keys(accounts)[0] : value.defaultAccount;
  return { value: { ...value, accounts, defaultAccount }, removed };
}

/** True when no other account still references this credential name. */
export function credentialUnusedAfterRemoval(value, ref) {
  if (!ref) return false;
  const accounts = Object.values(value?.accounts ?? {});
  return !accounts.some(account => account.appSecretRef === ref);
}

/**
 * C4: one bot, one account. Returns the id that already owns this app id, so the
 * caller can refuse the duplicate by name instead of opening a second connection
 * to the same Feishu application.
 */
export function accountOwningBot(accounts, appId, selfId) {
  const wanted = String(appId ?? '').trim();
  if (!wanted) return null;
  for (const [id, account] of Object.entries(accounts ?? {})) {
    if (id === selfId) continue;
    if (String(account?.appId ?? '').trim() === wanted) return id;
  }
  return null;
}

/** Credential reference name used for an account that has none yet. */
export function credentialRefFor(accountId) {
  return 'FEISHU_APP_SECRET_' + String(accountId).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}
