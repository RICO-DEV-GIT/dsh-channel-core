import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WORKSPACE_BASE, FALLBACK_WORKSPACE_DIR, addAccount, removeAccount, workspaceFor,
  workspaceToRemove, credentialRefFor, assertAppId,
} from '../lib/accounts.js';
import { accountView } from '../lib/channel-plugin-settings/account-view.js';
import { buildModelPickerCard, PAGE_SIZE, PAGE_PREFIX } from '../lib/model-picker-card.js';

/**
 * Requirement ↔ code contract.
 *
 * Each test names a requirement the operator stated, and asserts the code still honours it.
 * This is the "is the code still what we agreed" gate, separate from the platform-schema
 * compliance test.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, '..', relative), 'utf8');

const ACCOUNT = appId => ({
  enabled: true, appId, domain: 'feishu', appSecretRef: 'X', workspacePath: workspaceFor(DEFAULT_WORKSPACE_BASE, appId),
  allowedUsers: [], allowGroups: false, autoCollectGroups: false, allowedGroups: [], requireMention: true,
  inputMode: 'inherit', agentPreset: '', rolePreset: '', memoryNamespace: 'private', identityLinks: [],
  ownerMode: 'first-dm', ownerUserId: '', attachments: true, maxAttachmentMB: 10,
  streaming: { mode: 'progress', progress: {}, footer: {}, cardEngine: 'patch', finalFormat: 'auto' }, throttleMs: 750,
});

// ── 工作区 ────────────────────────────────────────────────────────────────
test('需求：工作区自动分配为 <根>\\<AppID>，不需要用户输入', () => {
  assert.equal(DEFAULT_WORKSPACE_BASE, 'G:\\DSWork');
  assert.equal(FALLBACK_WORKSPACE_DIR, 'DSWork', 'root missing → plugin dir / DSWork');
  assert.equal(workspaceFor('G:\\DSWork', 'cli_abc'), 'G:\\DSWork\\cli_abc');
});

test('需求：每个机器人独立工作区，AppID 唯一 ⇒ 目录唯一', () => {
  const first = addAccount({ schemaVersion: 1 }, { appId: 'cli_one', base: 'G:\\DSWork' });
  const second = addAccount(first.value, { appId: 'cli_two', base: 'G:\\DSWork' });
  const paths = Object.values(second.value.accounts).map(account => account.workspacePath);
  assert.equal(new Set(paths).size, paths.length);
});

test('需求：同一个机器人只能添加一次', () => {
  const first = addAccount({ schemaVersion: 1 }, { appId: 'cli_dup', base: 'G:\\DSWork' });
  assert.throws(() => addAccount(first.value, { appId: 'cli_dup', base: 'G:\\DSWork' }), /该机器人已经存在/);
});

test('需求：AppID 不能逃出工作区根目录', () => {
  assert.throws(() => assertAppId('..\\..\\windows'), /App ?ID|appid/i);
});

// ── 账号生命周期 ──────────────────────────────────────────────────────────
test('需求：只有新增和删除，没有"替换"', () => {
  const accounts = read('lib/accounts.js');
  // `String.replace` is fine; a replace *flow* would be a parameter or a branch.
  assert.equal(/\breplace\s*[:=]/.test(accounts), false, 'accounts.js offers no replace option');
  assert.equal(/replace\s*!==\s*true|replace\s*===\s*true/.test(accounts), false, 'no replace escape hatch');
  const remote = read('lib/channel-plugin-settings/remote-config.js');
  assert.equal(/replace\s*[:=]/.test(remote), false, 'registrationApply takes no replace parameter');
});

test('需求：可以把机器人全部删除', () => {
  const only = addAccount({ schemaVersion: 1 }, { appId: 'cli_solo', base: 'G:\\DSWork' });
  const emptied = removeAccount(only.value, only.accountId);
  assert.deepEqual(Object.keys(emptied.value.accounts), []);
});

test('需求：删除机器人时一并清理它的工作区（仅限自动分配的目录）', () => {
  const used = 'G:\\DSWork\\cli_del';
  assert.equal(workspaceToRemove({ used, derived: used, siblings: [] }), used);
  assert.equal(workspaceToRemove({ used: 'D:\\mine', derived: used, siblings: [] }), null, 'hand-picked folder is kept');
  assert.equal(workspaceToRemove({ used, derived: used, siblings: [used] }), null, 'a folder another bot uses is kept');
  assert.match(read('lib/channel-components.js'), /workspaceToRemove\(/, 'the removal path uses the guard');
});

test('需求：凭证名按账号自动生成（第一个沿用历史名）', () => {
  assert.equal(credentialRefFor('default'), 'FEISHU_APP_SECRET');
  assert.equal(credentialRefFor('account-2'), 'FEISHU_APP_SECRET_ACCOUNT_2');
});

// ── 每机器人独立设置 ──────────────────────────────────────────────────────
test('需求：每个 AppID 单独保存设置（含显示选项，不再有 shared）', () => {
  const file = {
    value: { schemaVersion: 2, defaultAccount: 'a', accounts: { a: ACCOUNT('cli_a'), b: ACCOUNT('cli_b') } },
    snapshot: () => ({ revision: 'r1' }),
    subscribe: () => () => {},
    save: next => { file.value = next; return next; },
  };
  const a = accountView(file, 'a');
  a.save({ ...a.value, streaming: { ...a.value.streaming, mode: 'off' } }, 'r1');
  assert.equal(file.value.accounts.a.streaming.mode, 'off');
  assert.equal(file.value.accounts.b.streaming.mode, 'progress', 'the sibling is untouched');
  assert.equal(file.value.shared, undefined, 'display options are per account now');
});

// ── 设置页 ────────────────────────────────────────────────────────────────
test('需求：该只读的字段只读，该可编辑的可编辑', () => {
  const pages = JSON.parse(read('tools/settings/pages.json'));
  const fields = pages['dsh-channel-feishu'].fields;
  const byKey = new Map(fields.map(field => [field.key, field]));
  assert.equal(byKey.has('appId'), false, 'App ID is not typed by hand');
  assert.equal(byKey.get('appSecretRef')?.type, 'readonly', 'credential name is assigned');
  assert.equal(byKey.get('domain')?.type, 'select', 'region stays editable');
  assert.equal(byKey.get('workspacePath')?.label, '修改工作区目录', 'workspace is editable, with migration');
});

test('需求：工作区改动会迁移数据', () => {
  const remote = read('lib/channel-plugin-settings/remote-config.js');
  assert.match(remote, /migrateWorkspace\(/);
  assert.match(remote, /cpSync\(/, 'files are copied, not dropped');
});

// ── 界面文案 ──────────────────────────────────────────────────────────────
test('需求：面板没有标题、没有多余提示，只保留快捷/手动两个入口', () => {
  const client = read('tools/build-client.mjs');
  assert.equal(client.includes('飞书机器人'), false, 'no panel title');
  assert.equal(client.includes('已可清理'), false, 'delete notice removed');
  assert.ok(client.includes('快捷配置') && client.includes('手动配置'));
});

test('需求：不认识本地盘符的用户也能理解（界面不写 G:\\DSWork）', () => {
  const client = read('lib/client.js');
  assert.equal(/G:\\\\DSWork/.test(client), false, 'the bundle never names the drive');
});

// ── /model 卡片 ───────────────────────────────────────────────────────────
test('需求：卡片是表格 6 行 + 下拉（含翻页项）+ 切换，卡片上没有翻页按钮', () => {
  const catalog = { groups: [{ id: 'p', models: Array.from({ length: 40 }, (_, i) => ({ id: 'm-' + i })) }] };
  const card = buildModelPickerCard({ catalog, page: 0 });
  const table = card.body.elements.find(element => element.tag === 'table');
  const form = card.body.elements.find(element => element.tag === 'form');
  const select = form.elements.find(element => element.tag === 'select_static');
  assert.equal(PAGE_SIZE, 6);
  assert.equal(table.rows.length, 6);
  assert.deepEqual(form.elements.map(element => element.tag), ['select_static', 'button']);
  assert.equal(form.elements[1].text.content, '切换');
  assert.ok(select.options.some(option => option.value.startsWith(PAGE_PREFIX)), 'paging lives in the list');
  assert.equal(card.body.elements.some(element => element.tag === 'button' || element.tag === 'column_set'), false, 'nothing paging-related outside the form');
});

test('需求：首页没有上一页项，末页没有下一页项', () => {
  const catalog = { groups: [{ id: 'p', models: Array.from({ length: 14 }, (_, i) => ({ id: 'm-' + i })) }] };
  const labels = card => card.body.elements.find(element => element.tag === 'form').elements[0].options
    .filter(option => option.value.startsWith(PAGE_PREFIX)).map(option => option.text.content);
  assert.deepEqual(labels(buildModelPickerCard({ catalog, page: 0 })).map(text => /上一页/.test(text)), [false]);
  assert.deepEqual(labels(buildModelPickerCard({ catalog, page: 2, })).map(text => /下一页/.test(text)), [false]);
});

// ── 平台交互方式 ──────────────────────────────────────────────────────────
test('平台：卡片更新走 API，不依赖回调响应（SDK 丢弃返回值）', () => {
  const transport = read('channels/feishu/transport.js');
  // Patching answered 200 without changing the card on the device, so the new state is
  // posted as a fresh card and the old one is recalled.
  assert.match(transport, /channel\.send\(event\.chatId,\{card:result\.card\}/, 'the new state is a fresh card');
  assert.match(transport, /channel\.recallMessage\(event\.messageId\)/, 'the old card is recalled');
  assert.equal(/response\.card\s*=/.test(transport), false, 'no writing to a response nobody sends');
});

test('平台：更新失败用消息告知，而不是 toast', () => {
  const transport = read('channels/feishu/transport.js');
  assert.match(transport, /卡片更新失败（/);
});
