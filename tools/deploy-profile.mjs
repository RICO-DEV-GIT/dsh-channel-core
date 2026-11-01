#!/usr/bin/env node
/**
 * Copy the plugin sources into the DSH profile that runs them, then print what changed.
 *
 * Copying alone does not take effect: the host has already loaded these modules, and its
 * HMR does not watch node_modules. After this script runs, reload the plugin entry
 * (`include:channel-core`) — disable then enable — which re-imports every module without
 * restarting DSH.
 *
 * Usage: node tools/deploy-profile.mjs [--profile <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const profileIndex = args.indexOf('--profile');
const profile = profileIndex >= 0
  ? path.resolve(args[profileIndex + 1])
  : path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh/profiles/desktop');
const target = path.join(profile, 'node_modules/dsh-channel-core');

if (!fs.existsSync(target)) {
  console.error('profile does not contain dsh-channel-core: ' + target);
  process.exit(1);
}

const FILES = [
  'lib/client.js', 'lib/index.js', 'lib/accounts.js', 'lib/workspace-scope.js',
  'lib/channel-components.js', 'lib/channel-plugin-settings/remote-config.js',
  'lib/channel-plugin-settings/account-view.js', 'lib/channel-plugin-settings/file-config.js',
  'lib/channel-runtime.js', 'lib/feishu-app-registration.js', 'lib/model-picker-card.js',
  'lib/model-card-diagnostics.js', 'lib/store.js', 'lib/channel-model-command.js',
  'channels/feishu/config.js', 'channels/feishu/transport.js', 'channels/discord/transport.js',
  'package.json',
];

const copied = [];
const identical = [];
for (const relative of FILES) {
  const from = path.join(root, relative);
  const to = path.join(target, relative);
  if (!fs.existsSync(from)) continue;
  const same = fs.existsSync(to) && fs.readFileSync(from).equals(fs.readFileSync(to));
  if (same) { identical.push(relative); continue; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied.push(relative);
}

console.log(JSON.stringify({ profile: target, copied, unchanged: identical.length }, null, 2));
if (!copied.length) console.log('already up to date');
else console.log('next: reload include:channel-core (disable then enable) — copying alone does not take effect');
