/**
 * Pre-flight credential check for the Feishu channel.
 *
 * Without it a wrong App ID / secret only surfaces as a WebSocket handshake that
 * never settles, which the settings page can only report as a timeout. Asking
 * the public token endpoint first turns that into the exact reason Feishu gives
 * (code + message), and it also distinguishes "credentials rejected" from
 * "credentials fine but the bot/event subscription is not enabled".
 */
const BASE = Object.freeze({ feishu: 'https://open.feishu.cn', lark: 'https://open.larksuite.com' });

export async function checkFeishuCredentials({ appId, appSecret, domain = 'feishu', fetchImpl = fetch, signal } = {}) {
  if (typeof appId !== 'string' || !appId.trim()) throw Object.assign(new Error('缺少 App ID'), { code: 'feishu-credentials-missing' });
  if (typeof appSecret !== 'string' || !appSecret.trim()) throw Object.assign(new Error('缺少 App Secret'), { code: 'feishu-credentials-missing' });
  const base = BASE[domain === 'lark' ? 'lark' : 'feishu'];
  let response;
  try {
    response = await fetchImpl(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId.trim(), app_secret: appSecret }),
      signal: signal ?? AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw Object.assign(new Error('无法连接飞书鉴权接口：' + (error?.message || '网络错误')), { code: 'feishu-credentials-unreachable' });
  }
  let json = null;
  try { json = await response.json(); } catch { /* handled below */ }
  if (!json || typeof json !== 'object') {
    throw Object.assign(new Error('飞书鉴权接口返回了无法解析的响应（HTTP ' + response.status + '）'), { code: 'feishu-credentials-bad-response' });
  }
  if (json.code !== 0 || !json.tenant_access_token) {
    // Feishu answers 200 with a non-zero code for a bad pair, so the HTTP status
    // alone is not enough to tell "rejected" from "accepted".
    const detail = [json.code, json.msg].filter(Boolean).join(' ');
    throw Object.assign(new Error('App ID 与密钥不匹配或应用不可用（飞书返回 ' + (detail || '未知错误') + '）'), { code: 'feishu-credentials-invalid' });
  }
  return { ok: true, token: true };
}
