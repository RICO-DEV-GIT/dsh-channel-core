import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registrationInit, registrationBegin, registrationPoll, registrationApplyConfig, resolveRegistrationSource,
  accountsBaseUrl, FEISHU_ACCOUNTS_URL, LARK_ACCOUNTS_URL, REGISTRATION_PATH,
} from '../lib/feishu-app-registration.js';

const jsonResponse = (status, body) => ({ status, text: async () => JSON.stringify(body) });
const record = [];
const stub = body => async (url, init) => {
  record.push({ url, init });
  return jsonResponse(200, body);
};

test('accounts base URLs target feishu vs lark', () => {
  assert.equal(accountsBaseUrl('feishu'), FEISHU_ACCOUNTS_URL);
  assert.equal(accountsBaseUrl('lark'), LARK_ACCOUNTS_URL);
  assert.equal(accountsBaseUrl('anything-else'), FEISHU_ACCOUNTS_URL);
});

test('registration init posts the form to the accounts endpoint', async () => {
  record.length = 0;
  const result = await registrationInit(stub({ supported_auth_methods: ['client_secret'] }), 'feishu');
  assert.deepEqual(result, { supported_auth_methods: ['client_secret'] });
  assert.equal(record.length, 1);
  assert.equal(record[0].url, FEISHU_ACCOUNTS_URL + REGISTRATION_PATH);
  assert.match(record[0].init.body, /action=init/);
});

test('registration begin renders a QR and adds the CLI-flow routing params', async () => {
  record.length = 0;
  const value = await registrationBegin(stub({
    device_code: 'v1:device-code',
    verification_uri_complete: 'https://open.feishu.cn/page/launcher?user_code=AB12-CD34',
    interval: 5,
    expire_in: 600,
  }), 'feishu');
  assert.equal(value.deviceCode, 'v1:device-code');
  assert.match(value.qrUrl, /user_code=AB12-CD34/);
  assert.match(value.qrUrl, /from=oc_onboard/);
  assert.match(value.qrUrl, /tp=ob_cli_app/);
  assert.match(value.qrPng, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  assert(value.qrPng.length > 200, 'QR payload must contain real pixels');
  assert.equal(value.intervalSeconds, 5);
  assert.equal(value.expireSeconds, 600);
  assert.equal(record[0].url, FEISHU_ACCOUNTS_URL + REGISTRATION_PATH);
  assert.match(record[0].init.body, /action=begin/);
  assert.match(record[0].init.body, /archetype=PersonalAgent/);
  assert.match(record[0].init.body, /auth_method=client_secret/);
  assert.match(record[0].init.body, /request_user_info=open_id/);
});

test('registration begin falls back to sane polling defaults', async () => {
  const value = await registrationBegin(stub({
    device_code: 'v1:device-code',
    verification_uri_complete: 'https://open.feishu.cn/page/launcher?user_code=AB12-CD34',
  }), 'lark');
  assert.equal(value.intervalSeconds, 5);
  assert.equal(value.expireSeconds, 600);
});

test('registration begin rejects a failed start with the server reason', async () => {
  const fail = async () => jsonResponse(400, { error: 'invalid_request', error_description: 'The archetype is unsupported.' });
  await assert.rejects(registrationBegin(fail, 'feishu'), /The archetype is unsupported\./);
});

test('registration poll maps a completed scan to credentials', async () => {
  record.length = 0;
  const result = await registrationPoll(stub({
    client_id: 'cli_abcdef123456',
    client_secret: 'super-secret',
    user_info: { open_id: 'ou_0123456789abcdef', tenant_brand: 'feishu' },
  }), 'feishu', 'v1:device-code');
  assert.equal(result.status, 'success');
  assert.equal(result.appId, 'cli_abcdef123456');
  assert.equal(result.appSecret, 'super-secret');
  assert.equal(result.openId, 'ou_0123456789abcdef');
  assert.equal(result.domain, 'feishu');
  assert.match(record[0].init.body, /action=poll/);
  assert.match(record[0].init.body, /device_code=v1%3Adevice-code/);
});

test('a client_id without a secret keeps polling instead of ending half-way', async () => {
  // The secret is minted with the id; stopping at the id alone is what made an
  // existing-app scan look successful while no credential was ever stored.
  const result = await registrationPoll(stub({ client_id: 'cli_abcdef123456' }), 'feishu', 'v1:device-code');
  assert.equal(result.status, 'pending');
  assert.equal(result.appId, undefined);
});

test('a Lark tenant switches the poll to the Lark accounts host', async () => {
  record.length = 0;
  const bodies = [
    jsonResponse(400, { error: 'authorization_pending', user_info: { tenant_brand: 'lark' } }),
    jsonResponse(200, { client_id: 'cli_lark', client_secret: 'lark-secret', user_info: { tenant_brand: 'lark' } }),
  ];
  let index = 0;
  const fetchImpl = async (url, init) => { record.push({ url, init }); return bodies[index++]; };
  const result = await registrationPoll(fetchImpl, 'feishu', 'v1:device-code');
  assert.equal(result.status, 'success');
  assert.equal(result.domain, 'lark');
  assert.match(record[0].url, /accounts\.feishu\.cn/);
  assert.match(record[1].url, /accounts\.larksuite\.com/, 'the retry goes to Lark');
});

test('registration poll keeps waiting while the scan is still pending', async () => {
  const pending = async () => jsonResponse(400, { error: 'authorization_pending', error_description: 'The user has not yet decided.' });
  const result = await registrationPoll(pending, 'feishu', 'v1:device-code');
  assert.equal(result.status, 'pending');
});

test('slow_down asks for a longer interval instead of failing', async () => {
  const result = await registrationPoll(async () => jsonResponse(400, { error: 'slow_down' }), 'feishu', 'v1:device-code');
  assert.deepEqual(result, { status: 'pending', slowDown: true });
});

test('registration poll maps denied and expired outcomes', async () => {
  const denied = await registrationPoll(async () => jsonResponse(403, { error: 'access_denied', error_description: 'access denied by user' }), 'feishu', 'v1:device-code');
  assert.equal(denied.status, 'access_denied');
  const expired = await registrationPoll(async () => jsonResponse(400, { error: 'expired_token', error_description: 'the code expired' }), 'feishu', 'v1:device-code');
  assert.equal(expired.status, 'expired');
});

test('a real failure is reported instead of looking like a pending scan', async () => {
  const result = await registrationPoll(async () => jsonResponse(400, { error: 'invalid_request', error_description: 'bad device code' }), 'feishu', 'v1:device-code');
  assert.equal(result.status, 'error');
  assert.equal(result.error, 'invalid_request');
  assert.match(result.message, /bad device code/);
});

test('registration source resolves through a thunk, an object, or nothing', async () => {
  const object = { begin: () => 1, poll: () => 2 };
  assert.equal(await resolveRegistrationSource(object), object, 'a ready object passes through');
  const viaThunk = await resolveRegistrationSource(() => object);
  assert.equal(viaThunk, object, 'the channel-components thunk wiring resolves to the source');
  assert.equal(await resolveRegistrationSource(() => null), null, 'a closed runtime yields no source');
  assert.equal(await resolveRegistrationSource(() => ({ begin: () => 1 })), null, 'a source without poll is not usable');
  assert.equal(await resolveRegistrationSource(undefined), null);
});

test('registration poll rejects an empty device code', async () => {
  await assert.rejects(registrationPoll(stub({}), 'feishu', ''), /feishu-registration-device-code-invalid/);
});

test('applying a fresh bot config claims the operator as owner', () => {
  const defaults = { enabled: false, accountId: 'default', appId: '', domain: 'feishu', appSecretRef: 'FEISHU_APP_SECRET', ownerMode: 'first-dm', ownerUserId: '', allowedUsers: [] };
  const next = registrationApplyConfig(defaults, { appId: 'cli_abcdef123456', openId: 'ou_0123456789abcdef' });
  assert.equal(next.appId, 'cli_abcdef123456');
  assert.equal(next.ownerMode, 'manual');
  assert.equal(next.ownerUserId, 'ou_0123456789abcdef');
  assert.deepEqual(next.allowedUsers, []);
});

test('applying to a configured bot only appends the operator to the allowlist', () => {
  const configured = { appId: 'cli_existing', ownerMode: 'first-dm', ownerUserId: '', allowedUsers: ['ou_aaa'] };
  const next = registrationApplyConfig(configured, { appId: 'cli_abcdef123456', openId: 'ou_0123456789abcdef' });
  assert.equal(next.appId, 'cli_abcdef123456');
  assert.equal(next.ownerMode, 'first-dm');
  assert.equal(next.ownerUserId, '');
  assert.deepEqual(next.allowedUsers, ['ou_aaa', 'ou_0123456789abcdef']);
  const again = registrationApplyConfig(next, { appId: 'cli_abcdef123456', openId: 'ou_0123456789abcdef' });
  assert.deepEqual(again.allowedUsers, ['ou_aaa', 'ou_0123456789abcdef'], 'no duplicates');
});

test('applying rejects an invalid App ID', () => {
  assert.throws(() => registrationApplyConfig({ appId: '' }, { appId: '   ' }), /feishu-registration-app-id-invalid/);
  assert.throws(() => registrationApplyConfig({ appId: '' }, {}), /feishu-registration-app-id-invalid/);
});
