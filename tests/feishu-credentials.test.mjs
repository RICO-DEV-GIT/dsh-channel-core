import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFeishuCredentials } from '../lib/feishu-credentials.js';

const reply = body => async () => ({ status: 200, json: async () => body });

test('a valid pair passes and is checked against the token endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { status: 200, json: async () => ({ code: 0, tenant_access_token: 't-abc' }) };
  };
  const result = await checkFeishuCredentials({ appId: 'cli_x', appSecret: 'sec', fetchImpl });
  assert.equal(result.ok, true);
  assert.match(calls[0].url, /open-apis\/auth\/v3\/tenant_access_token\/internal$/);
  assert.deepEqual(calls[0].body, { app_id: 'cli_x', app_secret: 'sec' });
});

test('a rejected pair reports Feishu code and message instead of timing out', async () => {
  const fetchImpl = reply({ code: 10014, msg: 'app secret invalid' });
  await assert.rejects(
    () => checkFeishuCredentials({ appId: 'cli_x', appSecret: 'bad', fetchImpl }),
    error => {
      assert.equal(error.code, 'feishu-credentials-invalid');
      assert.match(error.message, /10014/);
      assert.match(error.message, /app secret invalid/);
      return true;
    },
  );
});

test('missing fields and unreachable endpoints are distinguished', async () => {
  await assert.rejects(() => checkFeishuCredentials({ appId: '', appSecret: 'x', fetchImpl: reply({}) }), /缺少 App ID/);
  await assert.rejects(() => checkFeishuCredentials({ appId: 'cli_x', appSecret: '', fetchImpl: reply({}) }), /缺少 App Secret/);
  const offline = async () => { throw new Error('ENOTFOUND open.feishu.cn'); };
  await assert.rejects(
    () => checkFeishuCredentials({ appId: 'cli_x', appSecret: 's', fetchImpl: offline }),
    error => error.code === 'feishu-credentials-unreachable' && /无法连接飞书鉴权接口/.test(error.message),
  );
});

test('the Lark domain uses the Lark token endpoint', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return { status: 200, json: async () => ({ code: 0, tenant_access_token: 't' }) }; };
  await checkFeishuCredentials({ appId: 'cli_x', appSecret: 's', domain: 'lark', fetchImpl });
  assert.match(calls[0], /open\.larksuite\.com/);
});
