import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelRuntime, channelScope, presetCatalogOf, usablePresetOf } from '../lib/channel-runtime.js';
import { schema as feishuSchema } from '../channels/feishu/config.js';
import { schema as discordSchema } from '../channels/discord/config.js';

const runtimeWith = presets => Object.assign(Object.create(ChannelRuntime.prototype), {
  ctx: presets ? { get: name => (name === 'agentPresets' ? presets : undefined) } : { get: () => undefined },
  diagnostic: () => {},
  settings: { configFile: { value: {} } },
});

test('the shipped default preset follows the Host instead of naming one', () => {
  assert.equal(feishuSchema.defaults.agentPreset, '', 'feishu must not hard-code a preset id');
  assert.equal(discordSchema.defaults.agentPreset, '', 'discord must not hard-code a preset id');
});

test('the preset catalog lists what the Host declares', async () => {
  const catalog = await presetCatalogOf(runtimeWith({
    list: async () => [{ id: 'standard', name: 'Standard', order: 1 }, { id: 'ptc', order: 2, broken: 'boom' }],
    defaultId: 'standard',
  }));
  assert.deepEqual(catalog.presets, [
    { id: 'standard', name: 'Standard' },
    { id: 'ptc', name: 'ptc', broken: true },
  ]);
  assert.equal(catalog.default, 'standard');
});

test('a Host without the preset registry reports an empty catalog instead of failing', async () => {
  assert.deepEqual(await presetCatalogOf(runtimeWith(null)), { presets: [], default: '' });
  const failing = runtimeWith({ list: async () => { throw new Error('nope'); }, defaultId: 'standard' });
  assert.deepEqual(await presetCatalogOf(failing), { presets: [], default: '' });
});

test('the catalog is cached, because it is read on every inbound message', async () => {
  let calls = 0;
  const runtime = runtimeWith({ list: async () => { calls++; return [{ id: 'standard' }]; }, defaultId: 'standard' });
  await presetCatalogOf(runtime);
  await presetCatalogOf(runtime);
  assert.equal(calls, 1, 'a second read inside the TTL reuses the cached list');
  runtime.presetCatalogCache = { at: 0, value: runtime.presetCatalogCache.value };
  await presetCatalogOf(runtime);
  assert.equal(calls, 2, 'an expired cache is refreshed');
});

test('a preset fallback is forgotten once the configured preset works again', async () => {
  const runtime = Object.assign(Object.create(ChannelRuntime.prototype), {
    ctx: { get: name => (name === 'agentPresets' ? { list: async () => [{ id: 'standard' }], defaultId: 'standard' } : undefined) },
    diagnostic: () => {},
    core: { resolveSessionWorkspace: async (config) => ({ cwd: 'G:\\DSWork', agentPreset: config.agentPreset }) },
  });
  await ChannelRuntime.prototype.sessionContext.call(runtime, { agentPreset: 'agent', workspacePath: 'G:\\DSWork', memoryNamespace: 'private' });
  assert.equal(runtime.fallbackPreset, 'agent');
  await ChannelRuntime.prototype.sessionContext.call(runtime, { agentPreset: 'standard', workspacePath: 'G:\\DSWork', memoryNamespace: 'private' });
  assert.equal(runtime.fallbackPreset, null, 'the status line must stop claiming a fallback');
});

test('an unknown configured preset falls back to the Host default', async () => {
  const runtime = runtimeWith({ list: async () => [{ id: 'standard' }], defaultId: 'standard' });
  const unknown = await usablePresetOf(runtime, { agentPreset: 'agent' });
  assert.equal(unknown.agentPreset, '');
  assert.equal(unknown.fallback, true);
  assert.equal(unknown.wanted, 'agent');
  assert.deepEqual(await usablePresetOf(runtime, { agentPreset: 'standard' }), { agentPreset: 'standard', fallback: false });
  assert.deepEqual(await usablePresetOf(runtime, { agentPreset: '' }), { agentPreset: '', fallback: false });
  const noRegistry = await usablePresetOf(runtimeWith(null), { agentPreset: 'agent' });
  assert.deepEqual(noRegistry, { agentPreset: 'agent', fallback: false }, 'without a registry the configured value is kept');
});

test('session context uses the usable preset and scopes the session to it', async () => {
  const runtime = Object.assign(Object.create(ChannelRuntime.prototype), {
    ctx: { get: name => (name === 'agentPresets' ? { list: async () => [{ id: 'standard' }], defaultId: 'standard' } : undefined) },
    diagnostic: () => {},
    core: { resolveSessionWorkspace: async (config) => ({ cwd: 'G:\\DSWork', agentPreset: config.agentPreset }) },
  });
  const config = { agentPreset: 'agent', workspacePath: 'G:\\DSWork', memoryNamespace: 'private' };
  const context = await ChannelRuntime.prototype.sessionContext.call(runtime, config);
  assert.deepEqual(context.create, { cwd: 'G:\\DSWork' }, 'the unknown preset is not passed to the Host');
  assert.equal(context.scope.presetId, 'default', 'the scope follows the Host default');
  assert.deepEqual(context.scope, channelScope({ ...config, agentPreset: '', workspacePath: 'G:\\DSWork' }));
  assert.equal(runtime.fallbackPreset, 'agent', 'the substitution is remembered for the status line');
});
