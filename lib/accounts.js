/**
 * Account lifecycle for a channel config file.
 *
 * Kept separate from the RPC layer so the config transforms are pure and testable:
 * the caller owns the file, the runtimes and the store, this module only decides
 * what the new config object must look like.
 */
import { isMultiAccount, migrateToMultiAccount, nextAccountId } from '../channels/feishu/config.js';
import { assertWorkspaceDisjoint } from './workspace-scope.js';
import path from 'node:path';
import { stat } from 'node:fs/promises';

/**
 * Where every bot's own folder lives. One root, one subfolder per bot, so the
 * operator never has to choose a directory.
 */
export const DEFAULT_WORKSPACE_BASE = 'G:\\DSWork';

/** `<root>\<accountId>` — the workspace assigned to a bot automatically. */
export function joinWorkspace(root, accountId) {
  return path.join(String(root ?? DEFAULT_WORKSPACE_BASE).trim() || DEFAULT_WORKSPACE_BASE, String(accountId));
}

/**
 * Where bots live. `G:\DSWork` when it exists, otherwise the plugin's own install
 * directory, so a machine that does not have that drive still works without asking
 * the operator to choose a folder.
 * @param {{preferred?:string, fallback:string, exists?:(p:string)=>Promise<boolean>}} options
 */
export async function resolveWorkspaceBase({ preferred = DEFAULT_WORKSPACE_BASE, fallback, exists } = {}) {
  const isDirectory = exists ?? (async candidate => {
    try { return (await stat(candidate)).isDirectory(); } catch { return false; }
  });
  if (await isDirectory(preferred)) return preferred;
  return fallback ?? preferred;
}

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
/**
 * Add an account. A v1 file is promoted first, so the first "second bot" also
 * migrates the existing single bot instead of dropping it.
 *
 * The workspace is derived from the bot itself: `<base>\<appId>`. App IDs are
 * unique (C4), so the folder is unique without the operator choosing anything.
 * @returns {{ value: object, accountId: string, workspacePath: string }}
 */
export function addAccount(value, { appId = '', base, accountId, enabled = false, appSecretRef, workspacePath } = {}) {
  const promoted = promote(value);
  const accounts = { ...promoted.accounts };
  const id = accountId ? String(accountId) : nextAccountId(accounts);
  if (!ACCOUNT_ID.test(id)) throw new AccountError('account-id-invalid', '账号 ID 只能包含字母、数字、下划线和短横线');
  if (Object.hasOwn(accounts, id)) throw new AccountError('account-duplicate', '账号已存在：' + id);
  const botId = String(appId ?? '').trim();
  const root = String(base ?? DEFAULT_WORKSPACE_BASE).trim() || DEFAULT_WORKSPACE_BASE;
  const path = String(workspacePath ?? '').trim() || (botId ? joinWorkspace(root, botId) : '');
  if (!path) throw new AccountError('workspace-required', '工作区由 App ID 决定，请先绑定机器人');
  const candidate = {
    ...accounts,
    [id]: {
      enabled: enabled === true,
      appId: botId,
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
    throw new AccountError(check.code, check.code === 'workspace-overlap'
      ? '与机器人「' + check.conflict + '」使用了同一个工作区'
      : '请先为机器人「' + check.conflict + '」设置工作区，再新增');
  }
  return { value: { ...promoted, accounts: candidate }, accountId: id, workspacePath: path };
}

/**
 * Remove one account (config only — the caller stops the runtime and clears the
 * channel records first). Removing the last one is allowed: the page then shows
 * "no bots yet" and the next add starts from an empty map.
 * @returns {{ value: object, removed: object }}
 */
export function removeAccount(value, accountId) {
  if (!isMultiAccount(value)) throw new AccountError('account-single', '当前只有一个机器人，无法删除');
  const accounts = { ...value.accounts };
  if (!Object.hasOwn(accounts, accountId)) throw new AccountError('account-not-found', '机器人不存在：' + accountId);
  const removed = accounts[accountId];
  delete accounts[accountId];
  const remaining = Object.keys(accounts);
  const defaultAccount = value.defaultAccount === accountId ? (remaining[0] ?? '') : value.defaultAccount;
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
