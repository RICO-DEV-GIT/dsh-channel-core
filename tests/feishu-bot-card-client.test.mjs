import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');

test('Feishu offers one bot entry that becomes the chat QR once connected', () => {
  assert(source.includes('function FeishuBotPanel'), 'the bot panel is bundled');
  assert(!source.includes('function FeishuBotCard'), 'the old separate card is gone');
  assert(!source.includes('function FeishuRegistrationCard'), 'the old separate registration card is gone');
  assert(source.includes('e(FeishuBotPanel,{scope:rootScope,credentialApi})'), 'only the Feishu tab renders it, once');
  assert(source.includes("head('添加飞书机器人'"), 'the add-a-bot state');
  assert(source.includes("head('机器人已连接'"), 'connected state');
  assert(source.includes('打开与它的私聊'), 'the connected state explains the chat QR');
  assert(source.includes('二维码只包含机器人公开 open_id，不含任何密钥。'), 'the page states what the QR carries');
  assert(source.includes('复制链接'), 'the link stays usable without a camera');
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
  assert(source.includes('rowPoll'), 'the scan polls the device code for that row');
  assert(!source.includes('saveManual'), 'the manual credential form is gone');
  assert(!source.includes("id:'dcb-bot-secret'"), 'no secret input is rendered');
});

test('each state exposes at most two actions', () => {
  assert(!source.includes(",'刷新二维码')"), 'the duplicate refresh button is gone');
  assert(!source.includes(",'重新连接')"), 'the duplicate reconnect button is gone');
  assert.equal((source.match(/'复制链接'/g) ?? []).length, 1, 'only one copy-link button');
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
  // success; the panel lists what is still missing and fixes it in place. The
  // workspace has its own always-visible line, so it is not repeated here.
  assert(source.includes('首次使用还差这几项'), 'the health block is discoverable');
  assert(source.includes('已开启「连接渠道」'), 'the switch is checked');
  assert(source.includes('App ID 与密钥已就绪'), 'credentials are checked');
  assert(source.includes('工作区：'), 'the workspace has its own line');
  assert(source.includes('打开连接渠道'), 'the switch can be fixed in place');
  assert(source.includes('选择目录…'), 'the workspace can be picked, not typed');
  assert(source.includes('credentialApi.describe([secretRef])'), 'credential state comes from the host, not a guess');
});

test('the workspace uses the native directory picker with a manual fallback', () => {
  // A typed path is the easiest way to get it wrong; the desktop bridge opens the
  // OS dialog, which can also create a folder inside it.
  assert(source.includes('__DSH_DIRECTORY_PICKER__'), 'it uses the desktop native picker');
  assert(source.includes('当前客户端不支持系统目录选择'), 'a web-only client explains the fallback');
  assert(source.includes("'手动填写'"), 'typing stays available behind a toggle');
});

test('the workspace can be changed at any time, not only when it is missing', () => {
  // The health block disappears after all three checks pass, which used to remove
  // the only way to pick a different directory.
  assert(source.includes('更换目录…'), 'a replace action is offered when a workspace exists');
  assert(source.includes('dcb-workspace'), 'the line renders outside the health block');
  assert.equal((source.match(/workspaceLine\(\)/g) ?? []).length, 2, 'both connected states render it');
});

test('the console checklist only appears when it can help', () => {
  assert(source.includes('const needsHelp=!connected'), 'visibility is derived from channel state');
});

test('the bot list offers only add and delete', () => {
  assert(source.includes('dcb-accounts'), 'the bot list renders');
  assert(source.includes('+ 添加机器人'), 'one button adds a bot');
  assert(source.includes(",'删除'"), 'each bot can be deleted');
  assert(source.includes('确认删除'), 'deletion needs a second click');
  assert(source.includes('至少保留一个机器人'), 'the last bot cannot be deleted');
  assert(!source.includes('+ 新增账号'), 'the separate "create an empty account" step is gone');
  assert(!source.includes("row.appId?null:e('button'"), 'no row-level add-bot button remains');
});

test('the server refuses a duplicate bot and a silent replacement', () => {
  // Both rules live in the RPC layer; read the source because instantiating the
  // service needs the whole Host.
  const remote = fs.readFileSync(path.join(root, 'lib/channel-plugin-settings/remote-config.js'), 'utf8');
  assert(remote.includes('该机器人已经存在'), 'the same app cannot be added twice');
  assert(remote.includes("account.appId) === String(appId)"), 'duplicate detection compares the app id');
  assert(remote.includes("plugin-config/account-bound"), 'an already bound account refuses a different bot');
  assert(remote.includes('assertWorkspaceDisjoint'), 'binding validates the workspace too');
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
