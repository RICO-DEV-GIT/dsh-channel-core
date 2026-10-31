/**
 * Feishu/Lark bot card: the applink that opens a direct chat with the bot, plus
 * a QR rendering of it so a phone can scan instead of typing a chat id.
 *
 * The link only carries the bot's public `open_id`; it never contains app
 * credentials, tenant tokens, or any user identity. Generating the QR here
 * (host side) keeps the client bundle free of an encoder and lets the settings
 * page render a plain data URL.
 */
import QRCode from 'qrcode';

/** Feishu bot ids are `ou_…`; anything else is refused rather than encoded. */
const BOT_OPEN_ID = /^ou_[A-Za-z0-9_-]{4,256}$/;
const APP_LINK_HOST = Object.freeze({
  feishu: 'https://applink.feishu.cn',
  lark: 'https://applink.larksuite.com',
});
// `qrcode` reads `color.*` without defaulting when options are passed straight
// to `toDataURL`, so the palette is spelled out rather than inherited.
const QR_OPTIONS = Object.freeze({
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 280,
  color: Object.freeze({ dark: '#000000ff', light: '#ffffffff' }),
});
/** One-entry cache: the settings page reopens often, the link almost never changes. */
let cached;

export function botAppLink(domain, openId) {
  if (typeof openId !== 'string' || !BOT_OPEN_ID.test(openId)) throw new Error('feishu-bot-open-id-invalid');
  const host = domain === 'lark' ? APP_LINK_HOST.lark : APP_LINK_HOST.feishu;
  return `${host}/client/chat/open?openId=${encodeURIComponent(openId)}`;
}

/**
 * Build the scannable bot card. `identity` is what the channel SDK resolved
 * from `bot/v3/info` (`{ openId, name }`); a missing identity means the live
 * connection has not resolved one yet, so the caller renders "connect first".
 */
export async function buildBotCard(identity, domain) {
  const openId = identity?.openId;
  const link = botAppLink(domain, openId);
  const name = String(identity?.name ?? '').trim() || '飞书机器人';
  // The cache stores the identity too: a hit must answer with the same shape as
  // a miss, otherwise callers silently lose `openId` on the second request.
  if (cached?.link === link) return { name, openId, link, png: cached.png };
  const png = await QRCode.toDataURL(link, QR_OPTIONS);
  cached = Object.freeze({ link, png });
  return { name, openId, link, png };
}

/** Test seam: never let a stale cache mask a changed identity in a fresh process. */
export function clearBotCardCache() {
  cached = undefined;
}
