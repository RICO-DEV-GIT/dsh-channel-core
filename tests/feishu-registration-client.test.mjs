import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');

test('the merged bot panel keeps the scan-to-create/connect flow', () => {
  assert(source.includes('function FeishuBotPanel'), 'the panel is bundled');
  assert(source.includes("scope.call('registrationBegin'"), 'begin is fetched through the channel settings service');
  assert(source.includes("scope.call('registrationPoll'"), 'the scan outcome is polled through the same service');
  assert(source.includes("scope.call('registrationApply'"), 'the returned credentials are applied server-side');
  assert(source.includes("scope.call('botCard',{})"), 'the connected state still asks for the chat QR');
  assert(source.includes('credentialApi.set('), 'a fresh bot secret is saved through the standard credential API');
  assert(source.includes('FEISHU_APP_SECRET'), 'the default secret reference is used as a fallback');
  assert(source.includes("scope.runAction()"), 'a configured-but-disconnected bot can be reconnected from the card');
});

test('the bot panel never renders the device code in the page', () => {
  // The device code is an opaque bearer value: it travels as an RPC argument
  // and is never kept in view state or printed.
  assert(!source.includes('state.deviceCode'), 'device code is not stored in view state');
  assert(!source.includes("'设备码'"), 'the page does not print a device code label');
});

test('the preset field is a picker sourced from the Host catalog', () => {
  assert(source.includes('function PresetPicker'), 'preset picker is bundled');
  assert(source.includes('function AgentPresetHint'), 'the stale-value warning is bundled');
  assert(source.includes("scope.call('presetCatalog'"), 'the catalog is fetched through the channel settings service');
  assert(source.includes("else if (spec.type === 'preset')"), 'a preset field uses the picker');
  assert(source.includes('留空（跟随默认'), 'the empty option explains that it follows the Host default');
  assert(source.includes('本机不存在，会自动回退默认'), 'a saved id the Host lacks stays visible instead of vanishing');
  assert(source.includes('自动回退到默认预设'), 'the warning says the fallback is automatic');
  assert(source.includes('e(AgentPresetHint,{scope})'), 'both channel tabs render the warning');
});
