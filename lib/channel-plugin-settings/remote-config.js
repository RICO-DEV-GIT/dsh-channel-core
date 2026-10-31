import path from 'node:path';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { ConfigFile, ConfigError } from './file-config.js';
import { registrationApplyConfig, resolveRegistrationSource } from '../feishu-app-registration.js';
import { checkDirectory, createDirectory } from '../directory-tools.js';

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
  constructor(ctx, { service, packageName, schema, details, action, botCard, registration, presetCatalog }, legacy = {}) {
    if (Object.keys(legacy).length) throw new ConfigError('config-migration', `${packageName} 的设置已移入插件目录 config.json，请先迁移并移除 Cordis config 覆盖`);
    super(ctx, service);
    this.settingsContext = ctx;
    this.details = details;
    this.action = action;
    this.botCardSource = botCard;
    this.registrationSource = registration;
    this.presetCatalogSource = presetCatalog;
    this.configFile = new ConfigFile(path.resolve(ctx.dshHomePath(), '..', 'plugins', packageName, 'config.json'), {
      ...schema, onError: error => console.warn(`[${packageName}]`, error.code, error.message),
    });
    ctx.effect(() => () => this.configFile.close());
    for (const initialize of initializers) initialize.call(this);
  }
  getConfig() { return { ...this.configFile.reload(), details: this.details?.() ?? null }; }
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
  setConfig(value, revision) {
    try { this.configFile.save(value, revision); return this.getConfig(); }
    catch (error) { if (error instanceof ConfigError) throw new RemoteError('plugin-config/' + error.code, error.message, {}); throw error; }
  }
  async runAction() {
    if (this.configFile.closed || !this.action) throw new RemoteError('plugin-config/action-unavailable', '操作不可用', {});
    await this.action(); return this.getConfig();
  }
  /**
   * Channel-owned scannable card. Feishu returns `{name, openId, link, png}` once
   * the live connection resolved the bot identity; other channels return null so
   * the settings page can hide the section instead of showing a broken button.
   */
  async botCard() {
    if (this.configFile.closed || !this.botCardSource) return null;
    try { return await this.botCardSource(); }
    catch (error) { throw new RemoteError('plugin-config/bot-card-unavailable', error?.message || '机器人名片不可用', {}); }
  }
  /**
   * Feishu-only scan-to-create/connect flow. `begin` renders the registration
   * QR; `poll(deviceCode)` reports the scan outcome; `apply` writes the
   * returned App ID (and, on a fresh config, the operator's ownership) into
   * the channel config. Channels without a registration source reject the
   * calls so the settings page can hide the section.
   */
  async registrationBegin(domain) {
    const source = await resolveRegistrationSource(this.registrationSource);
    if (this.configFile.closed || !source) throw new RemoteError('plugin-config/registration-unavailable', '扫码创建机器人不可用', {});
    try { return await source.begin(String(domain ?? 'feishu')); }
    catch (error) { throw new RemoteError('plugin-config/registration-begin-failed', error?.message || '无法生成注册二维码', {}); }
  }
  async registrationPoll(deviceCode) {
    const source = await resolveRegistrationSource(this.registrationSource);
    if (this.configFile.closed || !source) throw new RemoteError('plugin-config/registration-unavailable', '扫码创建机器人不可用', {});
    try { return await source.poll(String(deviceCode ?? '')); }
    catch (error) { throw new RemoteError('plugin-config/registration-poll-failed', error?.message || '轮询注册结果失败', {}); }
  }
  /**
   * Named parameters, not one object: the Host gateway validates the arguments
   * against this signature and rejects unexpected fields, so the payload must
   * map to these parameters by name or it fails with "args fields do not match".
   */
  async registrationApply(appId, openId, domain) {
    if (this.configFile.closed) throw new RemoteError('plugin-config/registration-unavailable', '扫码创建机器人不可用', {});
    try {
      const snapshot = this.configFile.snapshot();
      const next = registrationApplyConfig(snapshot.value, { appId, openId, domain });
      this.configFile.save(next, snapshot.revision);
      return this.getConfig();
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
for (const name of ['getConfig', 'setConfig', 'runAction', 'botCard', 'registrationBegin', 'registrationPoll', 'registrationApply', 'presetCatalog', 'directoryCheck', 'directoryCreate', 'modelCatalog', 'roleCatalog']) Remote(PluginConfig.prototype[name], {
  kind: 'method', name, static: false, private: false, addInitializer: initialize => initializers.push(initialize),
});
