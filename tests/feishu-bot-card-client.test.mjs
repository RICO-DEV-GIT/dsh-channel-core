import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');

test('Feishu offers one bot entry that becomes the chat QR once connected', () => {
  assert(source.includes('function FeishuBotPanel'), 'the single bot panel is bundled');
  assert(!source.includes('function FeishuBotCard'), 'the old separate card is gone');
  assert(!source.includes('function FeishuRegistrationCard'), 'the old separate registration card is gone');
  assert(source.includes('e(FeishuBotPanel,{scope,credentialApi})'), 'only the Feishu tab renders it, once');
  // Three states, decided by the channel state instead of by the operator.
  assert(source.includes("head('连接飞书机器人'"), 'not configured / not connected state');
  assert(source.includes("head('机器人已连接'"), 'connected state');
  assert(source.includes('打开与它的私聊'), 'the connected state explains the chat QR');
  assert(source.includes('二维码只包含机器人公开 open_id，不含任何密钥。'), 'the page states what the QR carries');
  assert(source.includes('复制链接'), 'the link stays usable without a camera');
});

test('one scan owns the whole lifecycle: create, switch, or add the chat', () => {
  // No manual credential form and no replace button: the phone decides between
  // a new bot and an existing one, and the same scan stays available while bound.
  assert(source.includes('扫码添加 / 切换机器人'), 'the scan action is always offered');
  assert(!source.includes('更换机器人'), 'the replace button is gone');
  assert(!source.includes('saveManual'), 'the manual credential form is gone');
  assert(!source.includes("id:'dcb-bot-secret'"), 'no secret input is rendered');
  assert(source.includes('在手机上选择「新建机器人」或「已有机器人」'), 'the phone-side choice is explained');
  assert.equal((source.match(/scanBlock\(\)/g) ?? []).length, 2, 'both states render the scan block');
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

test('rebuilding the bundle keeps the already shipped settings renderer intact', () => {
  // The generated bundle is the shipped artifact; a rebuild from a stale
  // helper once dropped the multiline "restore default" editor. Keep it.
  assert(source.includes('dpc-prompt-editor'), 'multiline default-restore wrapper survives a rebuild');
  assert(source.includes("'恢复默认'"));
  assert(!source.includes('NewsArchiveView'), 'the retired outbound-archive view stays retired');
});
