import path from 'node:path';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { ConfigFile, ConfigError } from './file-config.js';
import { registrationApplyConfig, resolveRegistrationSource } from '../feishu-app-registration.js';
import { checkDirectory, createDirectory } from '../directory-tools.js';
import { accountView, isMultiAccountConfig } from './account-view.js';

export function defineConfig(defaults, rules = {}) {
  defaults = { schemaVersion: 1, ...defaults };
  const validate = input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConfigError('invalid-config', '配置必须是 JSON 对象');
    for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) throw new ConfigError('invalid-config', `未知配置项：${key}`);
    const value = structuredClone({ ...defaults, ...input });
    for (const [key, fallback] of Object.entries(defaults)) {
      if (Array.isArray(fallback) ? !Array.isArray(value[key]) || value[key].some(x => typeof x !== 'string') : typeof value[key] !== typeof fallback)
        throw new ConfigError('invalid-config', `配置项类型错误：${key}`);
      if (key === 'schemaVersion' && value[key] !== 1) throw new ConfigError('invalid-config', 'schemaVersion 必须为 1');
      if (rules[key] && !rules[key](value[key], value)) throw new ConfigError('invalid-config', `配置项取值无效：${key}`);
    }
    return Object.freeze(value);
  };
  return { defaults: validate(defaults), validate };
}

/** Each plugin owns its service and file; the official Gateway owns authentication. */
export class PluginConfig extends TypertRemoteService {
  constructor(ctx, { service, packageName, schema, provider, details, action, botCard, registration, presetCatalog, runtimes, accounts }, legacy = {}) {
    if (Object.keys(legacy).length) throw new ConfigError('config-migration', `${packageName} 的设置已移入插件目录 config.json，请先迁移并移除 Cordis config 覆盖`);
    super(ctx, service);
    this.settingsContext = ctx;
    this.provider = provider ?? packageName;
    // Legacy single-runtime hooks still work; `runtimes` is the multi-account form.
    this.legacy = { details, action, botCard, registration };
    this.runtimes = runtimes;
    this.accountOps = accounts;
    this.presetCatalogSource = presetCatalog;
    this.configFile = new ConfigFile(path.resolve(ctx.dshHomePath(), '..', 'plugins', packageName, 'config.json'), {
      ...schema, onError: error => console.warn(`[${packageName}]`, error.code, error.message),
    });
    ctx.effect(() => () => this.configFile.close());
    for (const initialize of initializers) initialize.call(this);
  }
  /** Account ids in the current file; a v1 file is one implicit "default". */
  accountIds() {
    const value = this.configFile.value;
    return isMultiAccountConfig(value) ? Object.keys(value.accounts ?? {}) : ['default'];
  }
  defaultAccountId() {
    const value = this.configFile.value;
    if (!isMultiAccountConfig(value)) return 'default';
    const ids = Object.keys(value.accounts ?? {});
    return ids.includes(value.defaultAccount) ? value.defaultAccount : ids[0];
  }
  /** Resolve and validate an account id coming from a client call. */
  resolveAccount(accountId) {
    const wanted = String(accountId ?? '').trim() || this.defaultAccountId();
    if (!this.accountIds().includes(wanted)) throw new RemoteError('plugin-config/account-not-found', '账号不存在：' + wanted, {});
    return wanted;
  }
  /**
   * Read paths tolerate a vanished account (deleted in another tab, or the file
   * changed underneath the page) and fall back to the default one; only writes
   * are allowed to fail loudly.
   */
  readAccount(accountId) {
    const wanted = String(accountId ?? '').trim();
    if (!wanted) return this.defaultAccountId();
    return this.accountIds().includes(wanted) ? wanted : this.defaultAccountId();
  }
  runtimeOf(accountId) {
    const map = this.runtimes?.();
    if (!map) return null;
    return map.get(accountId) ?? null;
  }
  viewOf(accountId) { return accountView(this.configFile, accountId); }
  accountsList() {
    return this.accountIds().map(id => {
      const value = this.viewOf(id).value ?? {};
      const details = this.runtimeOf(id)?.details?.() ?? null;
      const appId = String(value.appId ?? '');
      return {
        id,
        appIdMasked: appId.length > 8 ? appId.slice(0, 6) + '…' + appId.slice(-4) : appId,
        workspacePath: String(value.workspacePath ?? ''),
        // The reference name only — never the secret. The panel needs it to store a
        // scanned secret under the right account.
        credentialRef: String(value.appSecretRef ?? ''),
        enabled: value.enabled === true,
        connected: details?.connected === true,
        message: details?.message ?? '',
      };
    });
  }
  getConfig(accountId) {
    const id = this.readAccount(accountId);
    const snapshot = this.configFile.reload();
    return {
      ...snapshot,
      value: this.viewOf(id).value,
      accountId: id,
      details: this.runtimeOf(id)?.details?.() ?? this.legacy.details?.() ?? null,
      accounts: this.accountsList(),
    };
  }
  async modelCatalog(kind) {
    if (this.configFile.closed) throw new RemoteError('plugin-config/unavailable', '插件已停用', {});
    if (kind === 'embedding') return this.embeddingCatalog ? await this.embeddingCatalog() : { groups: [] };
    if (kind !== 'chat') throw new RemoteError('plugin-config/invalid-model-kind', '模型目录类型无效', {});
    const native = this.settingsContext.get('sessionController');
    return native ? await native.modelCatalog() : { groups: [] };
  }
  async roleCatalog() {
    const roles = this.settingsContext.get('instructionFilesSettings');
    if (!roles?.getProfiles) return { available: false, roles: [] };
    const result = await roles.getProfiles();
    return { available: true, roles: result.profiles.filter(row => row.registered).map(row => ({ preset: row.preset, name: row.name, workspaceTitle: row.workspaceTitle })) };
  }
  setConfig(value, revision, accountId) {
    const id = this.resolveAccount(accountId);
    try {
      const view = this.viewOf(id);
      view.save(value, revision);
      return this.getConfig(id);
    }
    catch (error) { if (error instanceof ConfigError) throw new RemoteError('plugin-config/' + error.code, error.message, {}); throw error; }
  }
  async runAction(accountId) {
    const id = this.resolveAccount(accountId);
    if (this.configFile.closed) throw new RemoteError('plugin-config/action-unavailable', '操作不可用', {});
    const runtime = this.runtimeOf(id);
    if (runtime) await runtime.reconfigure();
    else await this.legacy.action?.();
    return this.getConfig(id);
  }
  /** Multi-account lifecycle; the component layer owns the orchestration. */
  async accountCreate(workspacePath) {
    if (this.configFile.closed || !this.accountOps) throw new RemoteError('plugin-config/accounts-unavailable', '账号管理不可用', {});
    try { return await this.accountOps.create({ workspacePath }); }
    catch (error) { throw new RemoteError('plugin-config/' + (error?.code || 'account-create-failed'), error?.message || '新增账号失败', {}); }
  }
  async accountRemove(accountId) {
    if (this.configFile.closed || !this.accountOps) throw new RemoteError('plugin-config/accounts-unavailable', '账号管理不可用', {});
    const id = this.resolveAccount(accountId);
    try { return await this.accountOps.remove(id); }
    catch (error) { throw new RemoteError('plugin-config/' + (error?.code || 'account-remove-failed'), error?.message || '删除账号失败', {}); }
  }
  /**
   * Channel-owned scannable card. Feishu returns `{name, openId, link, png}` once
   * the live connection resolved the bot identity; other channels return null so
   * the settings page can hide the section instead of showing a broken button.
   */
  async botCard(accountId) {
    const id = this.resolveAccount(accountId);
    if (this.configFile.closed) return null;
    const source = this.runtimeOf(id)?.botCard ?? this.legacy.botCard;
    if (!source) return null;
    try { return await source.call(this.runtimeOf(id) ?? null); }
    catch (error) { throw new RemoteError('plugin-config/bot-card-unavailable', error?.message || '机器人名片不可用', {}); }
  }
  /**
   * Feishu-only scan-to-create/connect flow. `begin` renders the registration
   * QR; `poll(deviceCode)` reports the scan outcome; `apply` writes the
   * returned App ID (and, on a fresh config, the operator's ownership) into
   * the channel config. Channels without a registration source reject the
   * calls so the settings page can hide the section.
   */
  registrationSourceOf(accountId) {
    const runtime = this.runtimeOf(accountId);
    // `runtime.registration` reads `this.provider` / `this.settings`, so it must be
    // invoked through the runtime rather than passed around unbound.
    if (runtime) return resolveRegistrationSource(() => runtime.registration());
    return resolveRegistrationSource(this.legacy.registration);
  }
  async registrationBegin(domain, accountId) {
    const id = this.resolveAccount(accountId);
    const source = await this.registrationSourceOf(id);
    if (this.configFile.closed || !source) throw new RemoteError('plugin-config/registration-unavailable', '扫码创建机器人不可用', {});
    try { return await source.begin(String(domain ?? 'feishu')); }
    catch (error) { throw new RemoteError('plugin-config/registration-begin-failed', error?.message || '无法生成注册二维码', {}); }
  }
  async registrationPoll(deviceCode, accountId) {
    const id = this.resolveAccount(accountId);
    const source = await this.registrationSourceOf(id);
    if (this.configFile.closed || !source) throw new RemoteError('plugin-config/registration-unavailable', '扫码创建机器人不可用', {});
    try { return await source.poll(String(deviceCode ?? '')); }
    catch (error) { throw new RemoteError('plugin-config/registration-poll-failed', error?.message || '轮询注册结果失败', {}); }
  }
  /**
   * Named parameters, not one object: the Host gateway validates the arguments
   * against this signature and rejects unexpected fields, so the payload must
   * map to these parameters by name or it fails with "args fields do not match".
   */
  async registrationApply(appId, openId, domain, accountId) {
    const id = this.resolveAccount(accountId);
    if (this.configFile.closed) throw new RemoteError('plugin-config/registration-unavailable', '扫码创建机器人不可用', {});
    try {
      const view = this.viewOf(id);
      const snapshot = view.snapshot();
      const next = registrationApplyConfig(snapshot.value, { appId, openId, domain });
      view.save(next, snapshot.revision);
      // A scan is an explicit "connect this bot": start it without a second step.
      if (next.enabled === true) void this.runtimeOf(id)?.reconfigure?.();
      return this.getConfig(id);
    }
    catch (error) {
      if (error instanceof ConfigError) throw new RemoteError('plugin-config/' + error.code, error.message, {});
      throw new RemoteError('plugin-config/registration-apply-failed', error?.message || '写入机器人配置失败', {});
    }
  }
  /**
   * Presets the Host actually declares, so the settings page shows real choices
   * instead of a free-text id an operator cannot verify. An empty list means the
   * Host has no preset registry; the page then hides the hint rather than
   * claiming there are none.
   */
  async presetCatalog() {
    if (this.configFile.closed || !this.presetCatalogSource) return { presets: [], default: '' };
    try { return await this.presetCatalogSource(); }
    catch { return { presets: [], default: '' }; }
  }
  /**
   * The workspace path may be typed by hand; these two calls let the page check
   * it before saving and offer to create it. Filesystem work stays on the Host.
   */
  async directoryCheck(dirPath) {
    if (this.configFile.closed) throw new RemoteError('plugin-config/directory-unavailable', '目录检查不可用', {});
    try { return await checkDirectory(dirPath); }
    catch (error) { throw new RemoteError('plugin-config/' + (error?.code || 'directory-unreadable'), error?.message || '无法读取该路径', {}); }
  }
  async directoryCreate(dirPath) {
    if (this.configFile.closed) throw new RemoteError('plugin-config/directory-unavailable', '目录创建不可用', {});
    try { return await createDirectory(dirPath); }
    catch (error) { throw new RemoteError('plugin-config/' + (error?.code || 'directory-create-failed'), error?.message || '创建目录失败', {}); }
  }
}
const initializers = [];
for (const name of ['getConfig', 'setConfig', 'runAction', 'accountCreate', 'accountRemove', 'botCard', 'registrationBegin', 'registrationPoll', 'registrationApply', 'presetCatalog', 'directoryCheck', 'directoryCreate', 'modelCatalog', 'roleCatalog']) Remote(PluginConfig.prototype[name], {
  kind: 'method', name, static: false, private: false, addInitializer: initialize => initializers.push(initialize),
});
