import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');

test('the Feishu page is one panel with a list of bots and no name-card QR', () => {
  assert(source.includes('function FeishuBotPanel'), 'the bot panel is bundled');
  assert(!source.includes('function FeishuBotCard'), 'the old separate card is gone');
  assert(!source.includes('function FeishuRegistrationCard'), 'the old separate registration card is gone');
  assert(source.includes('e(FeishuBotPanel,{scope:rootScope,credentialApi})'), 'only the Feishu tab renders it, once');
  assert(source.includes("head('飞书机器人'"), 'one page title, in every state');
  // The name-card QR was removed on purpose: no QR appears unless a bot is added.
  assert(!source.includes("scope.call('botCard'"), 'the name-card QR is no longer fetched');
  assert(!source.includes('复制链接'), 'the name-card link block is gone');
  assert(!source.includes('名片二维码'), 'the copy no longer mentions a name card');
});

test('there is only add and delete: no replace, no switch, no persistent QR', () => {
  // The incident came from one control meaning two things. Adding always creates a
  // new row; changing a bot is delete + add, so an existing bot can never be
  // swapped out silently.
  assert(source.includes('添加机器人'), 'adding a bot is the only create action');
  assert(!source.includes('扫码添加 / 切换机器人'), 'the ambiguous switch/scan control is gone');
  assert(!source.includes('更换机器人'), 'there is no replace path at all');
  assert(!source.includes('scanBlock()'), 'no persistent scan block is rendered');
  assert(source.includes(",'删除'"), 'each row can be deleted');
  assert(source.includes('确认删除'), 'deletion needs a second click');
  assert(source.includes('accountCreate'), 'adding creates the row through the account RPC');
  assert(source.includes('accountRemove'), 'deleting goes through the account RPC');
  assert(source.includes('addPoll'), 'the scan polls its own device code');
  assert(source.includes('pendingWorkspace'), 'the row is created only after the phone confirms');
  assert(source.includes('添加失败'), 'a failed add rolls back');
  assert(!source.includes('saveManual'), 'the manual credential form is gone');
  assert(!source.includes("id:'dcb-bot-secret'"), 'no secret input is rendered');
});

test('each state exposes at most two actions', () => {
  assert(!source.includes(",'刷新二维码')"), 'the duplicate refresh button is gone');
  assert(!source.includes(",'重新连接')"), 'the duplicate reconnect button is gone');
  assert.equal((source.match(/'复制链接'/g) ?? []).length, 0, 'no copy-link button remains');
});

test('the credential fields are not rendered twice', () => {
  // The panel owns appId + secret, so the Feishu page definition declares
  // neither field nor a credential block: one entry per value.
  const match = source.match(/const bundledChannelPanels=([^\n]+);/);
  assert(match, 'the bundled pages are inlined');
  const pages = JSON.parse(match[1]);
  const keys = pages.feishu.fields.map(field => field.key);
  assert(!keys.includes('appId'), 'the form no longer declares App ID');
  assert(!keys.includes('credentialSecret'), 'the form no longer declares the secret');
  assert.equal(pages.feishu.credentialFields, undefined, 'no separate credential block');
});

test('first-run health names the settings that make a scan useless', () => {
  // Scanning while the switch is off (or without credentials) used to look like
  // success; the panel lists what is still missing and fixes it in place.
  assert(source.includes('首次使用还差这几项'), 'the health block is discoverable');
  assert(source.includes('已开启「连接渠道」'), 'the switch is checked');
  assert(source.includes('App ID 与密钥已就绪'), 'credentials are checked');
  assert(source.includes('打开连接渠道'), 'the switch can be fixed in place');
  assert(source.includes('credentialApi.describe([secretRef])'), 'credential state comes from the host, not a guess');
});

test('the workspace is assigned, never asked for', () => {
  // No directory picker, no path input: the folder is G:\DSWork\<appId> and the
  // bot row simply shows it.
  assert(!source.includes('__DSH_DIRECTORY_PICKER__'), 'no directory picker is used');
  assert(!source.includes('directoryCheck'), 'no path validation dialog is offered');
  assert(!source.includes('工作区：'), 'no workspace input row is rendered');
  assert(source.includes('row.workspacePath||'), 'the row shows the assigned workspace');
});

test('the console checklist only appears when it can help', () => {
  assert(source.includes('const needsHelp=!connected'), 'visibility is derived from channel state');
});

test('the bot list offers only add and delete', () => {
  assert(source.includes('dcb-accounts'), 'the bot list renders');
  assert(source.includes('+ 添加机器人'), 'one button adds a bot');
  assert(source.includes(",'删除'"), 'each bot can be deleted');
  assert(source.includes('确认删除'), 'deletion needs a second click');
  assert(!source.includes('至少保留一个机器人'), 'every bot can be deleted, including the last');
  assert(!source.includes('+ 新增账号'), 'the separate "create an empty account" step is gone');
  assert(!source.includes("row.appId?null:e('button'"), 'no row-level add-bot button remains');
});

test('the server enforces the hard constraints', () => {
  // These rules live in the RPC layer; read the source because instantiating the
  // service needs the whole Host.
  const remote = fs.readFileSync(path.join(root, 'lib/channel-plugin-settings/remote-config.js'), 'utf8');
  assert(remote.includes('该机器人已经存在'), 'C4: the same app cannot be added twice');
  assert(remote.includes('accountOwningBot'), 'C4: duplicate detection uses the shared helper');
  assert(remote.includes('plugin-config/account-bound'), 'C5: a bound account refuses a different bot');
  assert(!remote.includes('replace !== true'), 'C5: there is no replace escape hatch');
  assert(remote.includes('assertWorkspaceDisjoint'), 'C2/C6: binding and saving both validate the workspace');
  assert(remote.includes('this.assertWorkspace(value ?? {}, id)'), 'C6: saving the form is validated too');
});

test('a failing connection shows the console checklist', () => {
  // The manual path cannot work unless the app enables bot capability and a
  // long-connection subscription; the page has to name those switches.
  assert(source.includes('连接不上？按这 6 项检查飞书开发者后台'), 'the checklist is discoverable');
  assert(source.includes('「事件与回调 → 订阅方式」选择「长连接」'), 'the subscription mode is spelled out');
  assert(source.includes('im.message.receive_v1'), 'the required event is named');
  assert(source.includes('版本管理与发布'), 'publishing is called out');
  assert(source.includes('扫码时在手机上选择「已有机器人」会直接使用该应用的凭证'), 'the scan is the supported way to reuse an app');
  assert(source.includes('setChecklist(true)'), 'a failed connect opens it automatically');
});

test('the settings form follows the selected account', () => {
  // Without a shared selection the bot panel and the form below it would edit
  // different accounts, and the second bot could never be configured.
  assert(source.includes('accountSelection'), 'one selection store is shared');
  assert(source.includes('createAccountScope'), 'the form talks to the selected account');
  assert(source.includes('编辑设置'), 'the page says which bot is being edited');
  assert(source.includes("useSelectedAccount"), 'both components read the same selection');
});

test('rebuilding the bundle keeps the already shipped settings renderer intact', () => {
  // The generated bundle is the shipped artifact; a rebuild from a stale
  // helper once dropped the multiline "restore default" editor. Keep it.
  assert(source.includes('dpc-prompt-editor'), 'multiline default-restore wrapper survives a rebuild');
  assert(source.includes("'恢复默认'"));
  assert(!source.includes('NewsArchiveView'), 'the retired outbound-archive view stays retired');
});
