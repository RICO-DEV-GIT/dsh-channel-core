/**
 * Feishu/Lark "scan to create or connect a bot" onboarding.
 *
 * Feishu hosts a device-code registration flow on its accounts service:
 *   POST /oauth/v1/app/registration   action=init | begin | poll
 *
 * `begin` returns a verification URL that we render as a QR. After the phone
 * scans it and confirms, `poll` returns the credentials of the bot that Feishu
 * just created (client_id/client_secret) plus the operator's `open_id`.
 * Choosing an existing app on the phone page ends with Feishu showing the
 * credentials to copy, so `poll` reports success without a secret and the
 * caller falls back to the manual credential input on the settings page.
 *
 * The endpoint is official but not part of the public open-apis suite; it may
 * change. Every request is a plain POST with URL-encoded form fields and no
 * stored state, so the flow stays restart-safe: a lost poll just expires.
 */
import QRCode from 'qrcode';

export const FEISHU_ACCOUNTS_URL = 'https://accounts.feishu.cn';
export const LARK_ACCOUNTS_URL = 'https://accounts.larksuite.com';
export const REGISTRATION_PATH = '/oauth/v1/app/registration';

const REQUEST_TIMEOUT_MS = 10_000;
// Same palette rule as lib/bot-card.js: `qrcode` reads `color.*` without
// defaulting when options are passed straight to `toDataURL`.
const QR_OPTIONS = Object.freeze({
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 280,
  color: Object.freeze({ dark: '#000000ff', light: '#ffffffff' }),
});

export function accountsBaseUrl(domain) {
  return domain === 'lark' ? LARK_ACCOUNTS_URL : FEISHU_ACCOUNTS_URL;
}

async function post(fetchImpl, baseUrl, body) {
  const response = await fetchImpl(`${baseUrl}${REGISTRATION_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body (rare) is treated as pending */ }
  return { status: response.status, json, text };
}

/** Step 1: confirm the environment supports the `client_secret` auth method. */
export async function registrationInit(fetchImpl = fetch, domain = 'feishu') {
  const { status, json } = await post(fetchImpl, accountsBaseUrl(domain), { action: 'init' });
  if (status !== 200 || !json) throw new Error('feishu-registration-init-failed');
  return json;
}

/**
 * Step 2: start the device-code flow. Returns the QR (as a data URL) the phone
 * scans, the device code used for polling, and the poll cadence/lifetime.
 */
export async function registrationBegin(fetchImpl = fetch, domain = 'feishu') {
  const { status, json } = await post(fetchImpl, accountsBaseUrl(domain), {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id',
  });
  if (status !== 200 || !json || !json.device_code || !json.verification_uri_complete) {
    throw new Error(json?.error_description || 'feishu-registration-begin-failed');
  }
  // `from`/`tp` route the consent page to the CLI-style onboarding that offers
  // both "create a new app" and "use an existing app" choices.
  const qrUrl = new URL(json.verification_uri_complete);
  qrUrl.searchParams.set('from', 'oc_onboard');
  qrUrl.searchParams.set('tp', 'ob_cli_app');
  const qrPng = await QRCode.toDataURL(qrUrl.toString(), QR_OPTIONS);
  return {
    deviceCode: json.device_code,
    qrUrl: qrUrl.toString(),
    qrPng,
    intervalSeconds: Number.isFinite(json.interval) && json.interval > 0 ? json.interval : 5,
    expireSeconds: Number.isFinite(json.expire_in) && json.expire_in > 0 ? json.expire_in : 600,
  };
}

/**
 * Step 3: poll for the scan outcome. The accounts service answers 4xx (with a
 * JSON body) while the user is still deciding or after a terminal state.
 *
 * The success shape is `client_id` **and** `client_secret` together — that is
 * what makes a scan able to fill a bot in without any manual paste, for a newly
 * created app and for one picked from the existing list alike. Stopping at
 * `client_id` alone (the first version did) ends the flow half-way: the card
 * reports the app id, no secret is ever stored, and the channel then connects
 * with a mismatched pair. Errors are mapped by name so a real failure is not
 * mistaken for "still waiting".
 */
export async function registrationPoll(fetchImpl = fetch, domain = 'feishu', deviceCode) {
  if (typeof deviceCode !== 'string' || !deviceCode.length) throw new Error('feishu-registration-device-code-invalid');
  let currentDomain = domain === 'lark' ? 'lark' : 'feishu';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json } = await post(fetchImpl, accountsBaseUrl(currentDomain), {
      action: 'poll', device_code: deviceCode, tp: 'ob_cli_app',
    });
    // A Feishu-branded QR scanned by a Lark tenant only resolves on the Lark
    // accounts host; retry there once instead of failing the whole scan.
    if (json?.user_info?.tenant_brand === 'lark' && currentDomain !== 'lark') {
      currentDomain = 'lark';
      continue;
    }
    if (json?.client_id && json?.client_secret) {
      return {
        status: 'success',
        appId: String(json.client_id),
        appSecret: String(json.client_secret),
        openId: typeof json.user_info?.open_id === 'string' ? json.user_info.open_id : undefined,
        domain: currentDomain,
      };
    }
    const error = String(json?.error ?? '');
    if (!error || error === 'authorization_pending') return { status: 'pending' };
    if (error === 'slow_down') return { status: 'pending', slowDown: true };
    if (error === 'access_denied') return { status: 'access_denied' };
    if (error === 'expired_token') return { status: 'expired' };
    // A `client_id` without a secret means the accounts service has not finished
    // minting the credential yet; keep polling rather than reporting success.
    if (typeof json?.client_id === 'string' && !json?.error) return { status: 'pending' };
    return { status: 'error', error, message: String(json?.error_description ?? error) };
  }
  return { status: 'pending' };
}

/**
 * Resolve a registration source that may be passed either as a ready object
 * (`{ begin, poll }`) or as a thunk returning one (the channel-components
 * wiring). Returns null when there is no usable source, so callers can report
 * "unavailable" instead of crashing on a missing `begin`.
 */
export async function resolveRegistrationSource(source) {
  const resolved = typeof source === 'function' ? await source() : source;
  return resolved && typeof resolved.begin === 'function' && typeof resolved.poll === 'function' ? resolved : null;
}

/**
 * Conservative config merge for an auto-created/auto-connected bot. Only the
 * App ID is always written. A bot whose config is still at defaults also
 * claims the operator as the owner (like the phone page's own DM lock); a bot
 * that already has an owner/user list only gets the operator appended to the
 * allowlist — never clobbering existing routing or ownership choices.
 */
export function registrationApplyConfig(current, { appId, openId, domain } = {}) {
  if (typeof appId !== 'string' || !appId.trim()) throw new Error('feishu-registration-app-id-invalid');
  const next = { ...current, appId: appId.trim() };
  // A Lark tenant's scan resolves on the Lark host; keep the config in step so
  // the transport talks to the same platform the bot actually lives on.
  if (domain === 'lark' || domain === 'feishu') next.domain = domain;
  if (typeof openId === 'string' && openId.length) {
    // "Fresh" is judged by ownership, not by appId: a bot slot is created with its
    // App ID already set (the folder is derived from it), so keying freshness on
    // appId meant the operator was never recorded as the owner.
    const fresh = !current.ownerUserId && !(current.allowedUsers ?? []).length;
    if (fresh) { next.ownerUserId = openId; next.ownerMode = 'manual'; }
    else if (!next.allowedUsers.includes(openId)) { next.allowedUsers = [...next.allowedUsers, openId]; }
  }
  // A completed scan is an explicit "I want this bot connected": leaving the
  // switch off was the most common dead end (credentials written, nothing
  // connected, and the page only said "not connected yet").
  next.enabled = true;
  return next;
}
