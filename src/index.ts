// Telegram link builders.
//
// This module is also the engine behind the hosted generator at
// adminhub.tools/tools/telegram-link-generator/ — the two copies are
// independent files, so a change to a link format or a validation rule
// belongs in both.
//
// Every format here is copied from a line in Telegram's own documentation and
// nothing else is invented: an "almost right" deep link fails silently — the
// client opens the chat and drops the payload — so a generator that guesses is
// worse than no generator.
//
// Sources (checked September 2026):
//   core.telegram.org/api/links      — the full t.me / tg:// syntax table
//   core.telegram.org/bots/features  — deep linking, the 64-character start
//                                      parameter, bot username rules
//   telegram.org/faq                 — "You can use a-z, 0-9 and underscores"
//                                      and the t.me/+phone form
//
// Deliberately dependency-free and written in erasable TypeScript (no enums,
// no namespaces): the JavaScript this package publishes is this file with the
// type annotations removed and nothing else added.

/** The eight link types this module builds. */
export type LinkType =
  | 'profile'
  | 'bot'
  | 'startgroup'
  | 'miniapp'
  | 'share'
  | 'phone'
  | 'post'
  | 'privatepost';

export const LINK_TYPES: LinkType[] = [
  'profile',
  'bot',
  'startgroup',
  'miniapp',
  'share',
  'phone',
  'post',
  'privatepost',
];

/**
 * Every link comes as a pair: the https form that works everywhere (including
 * inside a browser, a QR code or an email), and the tg:// form documented next
 * to it, which skips the redirect page but only resolves where Telegram is
 * installed.
 */
export interface LinkPair {
  https: string;
  tg: string;
}

/**
 * What a validator returns. One code per field rather than one per failure
 * mode: the message shown to the reader states the whole rule ("5-32 Latin
 * letters, digits or underscores, ending in bot"), which is more useful than
 * telling them which half of it they broke.
 */
export type ErrorCode =
  | 'username'
  | 'botUsername'
  | 'payload'
  | 'appName'
  | 'url'
  | 'phone'
  | 'messageId'
  | 'chatId';

const TME = 'https://t.me';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Documented for bot usernames: "5-32 characters long and not case sensitive
 * - but may only include Latin characters, numbers, and underscores"
 * (core.telegram.org/bots/features). The FAQ repeats the character set for
 * ordinary usernames ("You can use a-z, 0-9 and underscores") but states no
 * length there, so the general validator enforces the maximum and not the
 * minimum — collectible short usernames sold through Fragment are real and a
 * five-character floor would reject them.
 */
export const USERNAME_MAX = 32;
export const BOT_USERNAME_MIN = 5;

/**
 * "The parameter can be up to 64 characters long" and "A-Z, a-z, 0-9, _ and -
 * are allowed" (core.telegram.org/bots/features); the API reference calls the
 * same field "up to 64 base64url characters".
 */
export const START_PAYLOAD_MAX = 64;

/**
 * Sanity bounds on a phone number, not a Telegram rule: E.164 allows at most
 * fifteen digits, and nothing shorter than six is a dialable international
 * number. Telegram documents neither — it just resolves whatever it is given.
 */
export const PHONE_MIN_DIGITS = 6;
export const PHONE_MAX_DIGITS = 15;

const USERNAME_RE = /^[A-Za-z0-9_]+$/;
const PAYLOAD_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Path segments t.me spends on something other than a username.
 *
 * core.telegram.org/api/links states the list while explaining the
 * `<username>.t.me` form: a subdomain is treated as a username only if it "is
 * not equal to any of: addemoji addlist addstickers addstyle addtheme auction
 * auth boost call confirmphone contact giftcode invoice joinchat login m nft
 * proxy setlanguage share socks web a k z". `c` is added because the same page
 * spends it on `t.me/c/<channel>/<id>`, and `www` because the same sentence
 * excludes it.
 *
 * Building `t.me/share` as if it were a channel produces a link that opens
 * something — which is worse than one that fails, because it looks like it
 * worked.
 */
export const RESERVED_USERNAMES: string[] = [
  'a',
  'addemoji',
  'addlist',
  'addstickers',
  'addstyle',
  'addtheme',
  'auction',
  'auth',
  'boost',
  'c',
  'call',
  'confirmphone',
  'contact',
  'giftcode',
  'invoice',
  'joinchat',
  'k',
  'login',
  'm',
  'nft',
  'proxy',
  'setlanguage',
  'share',
  'socks',
  'web',
  'www',
  'z',
];

const RESERVED = new Set(RESERVED_USERNAMES);

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

/**
 * `decodeURIComponent` that cannot throw. A malformed escape is left exactly
 * as it was typed, which keeps a `%` in the handle and therefore fails
 * `validateUsername` — a rejected value, not a raised exception.
 */
function decodeDomain(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Turn whatever a reader pasted into a bare username.
 *
 * Accepts `@name`, `name`, `t.me/name`, `https://t.me/name/`, `telegram.me`
 * and `telegram.dog` hosts, the `name.t.me` subdomain form documented on
 * core.telegram.org/api/links, and a `tg://resolve?domain=name` copied out of
 * a desktop client. Anything after the handle — a path, a query string, a
 * fragment — is dropped, because every caller here wants the handle alone.
 */
export function normalizeUsername(input: string): string {
  let value = (input ?? '').trim();
  if (!value) return '';

  // tg://resolve?domain=<username>[&…] — pulled out before the scheme strip,
  // since the rest of that URL is a query string and not a path.
  //
  // The decode is guarded: `decodeURIComponent` throws URIError on a stray or
  // truncated escape (`%`, `abc%`, `%zz`, `%E0%A4` — the last one is a valid
  // pair of bytes that is not a complete UTF-8 sequence). Callers hand this
  // function raw user input, so a throw here would turn a typo into an
  // exception on a code path that has no other way to fail. On a bad escape
  // the raw text is returned instead and the validator rejects it in the
  // ordinary way, with the usual message about the allowed character set.
  const resolved = /^tg:\/\/resolve\?(?:[^#]*&)?domain=([^&#]+)/i.exec(value);
  if (resolved) return decodeDomain(resolved[1]).replace(/^@+/, '').trim();

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // any scheme
  value = value.replace(/^www\./i, '');

  const onHost = /^(?:t\.me|telegram\.me|telegram\.dog)\/(.*)$/i.exec(value);
  if (onHost) {
    value = onHost[1];
  } else {
    const subdomain = /^([^./]+)\.t\.me(?:\/.*)?$/i.exec(value);
    if (subdomain) value = subdomain[1];
  }

  value = value.replace(/^@+/, '');
  value = value.split(/[/?#]/)[0];
  return value.trim();
}

/** Keep the digits and throw away the punctuation people type into phone fields. */
export function normalizePhone(input: string): string {
  return (input ?? '').replace(/\D+/g, '');
}

/**
 * Bot API chat ids for channels and supergroups carry a `-100` prefix that the
 * `t.me/c/` form does not use. `-1001234567890` becomes `1234567890`.
 *
 * The prefix is only stripped when the id is negative, which is the shape the
 * Bot API hands out; a positive number is assumed to be the internal id
 * already and is passed through, because `1001234567890` is genuinely
 * ambiguous and guessing would corrupt a valid id.
 *
 * Returns null when the input is not a plain integer.
 */
export function toInternalChannelId(input: string): string | null {
  const value = (input ?? '').trim().replace(/\s+/g, '');
  const parsed = /^(-?)(\d+)$/.exec(value);
  if (!parsed) return null;

  let digits = parsed[2];
  if (parsed[1] === '-' && digits.startsWith('100') && digits.length > 3) {
    digits = digits.slice(3);
  }
  digits = digits.replace(/^0+/, '');
  return digits.length > 0 ? digits : null;
}

/** A positive integer message id, or null. */
export function parseMessageId(input: string): number | null {
  const value = (input ?? '').trim().replace(/[\s,]/g, '');
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------------------
// Validators — each returns its ErrorCode, or null when the value is usable
// ---------------------------------------------------------------------------

/** Public username of a user, group or channel. Expects a normalised handle. */
export function validateUsername(username: string): ErrorCode | null {
  if (!username) return 'username';
  if (username.length > USERNAME_MAX) return 'username';
  if (!USERNAME_RE.test(username)) return 'username';
  // Usernames are case-insensitive, so the comparison is too.
  if (RESERVED.has(username.toLowerCase())) return 'username';
  return null;
}

/**
 * Bot username: the general rule plus the two extra ones BotFather enforces —
 * at least five characters, and "Your bot's username must end in 'bot'"
 * (case-insensitive: the docs' own examples are `tetris_bot` and `TetrisBot`).
 */
export function validateBotUsername(username: string): ErrorCode | null {
  if (validateUsername(username) !== null) return 'botUsername';
  if (username.length < BOT_USERNAME_MIN) return 'botUsername';
  if (!username.toLowerCase().endsWith('bot')) return 'botUsername';
  return null;
}

/** Start / startgroup / startapp payload. Optional everywhere, so "" is valid. */
export function validateStartPayload(payload: string): ErrorCode | null {
  if (!payload) return null;
  if (payload.length > START_PAYLOAD_MAX) return 'payload';
  if (!PAYLOAD_RE.test(payload)) return 'payload';
  return null;
}

/**
 * Mini App short name. The docs name the field (`appname`, passed to
 * `inputBotAppShortName.short_name`) but state no length or character rule, so
 * only the character set shared by every Telegram short name is enforced and
 * no length is invented.
 */
export function validateAppName(appName: string): ErrorCode | null {
  if (!appName) return null;
  return USERNAME_RE.test(appName) ? null : 'appName';
}

/**
 * URL for a share link. The docs say only "URL to share (urlencoded)"; this
 * insists on an absolute http(s) address because a relative one has nothing to
 * resolve against once it is inside a Telegram message.
 */
export function validateShareUrl(url: string): ErrorCode | null {
  const value = (url ?? '').trim();
  if (!value) return 'url';
  if (!/^https?:\/\/[^\s/?#]+\.[^\s]+$/i.test(value)) return 'url';
  return null;
}

/** Phone number, already reduced to digits by normalizePhone. */
export function validatePhone(digits: string): ErrorCode | null {
  if (!digits) return 'phone';
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) return 'phone';
  return null;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Public username link — a user, a group or a channel.
 * Docs: `t.me/<username>` and `tg://resolve?domain=<username>`.
 */
export function buildProfileLink(username: string): LinkPair {
  return { https: `${TME}/${username}`, tg: `tg://resolve?domain=${username}` };
}

/**
 * Bot deep link.
 * Docs: `t.me/<bot_username>?start=<parameter>` and
 * `tg://resolve?domain=<bot_username>&start=<parameter>`.
 *
 * With no payload this is just the bot's username link, which is what Telegram
 * itself does — the `start` parameter is documented as optional.
 */
export function buildBotStartLink(bot: string, payload: string = ''): LinkPair {
  if (!payload) return buildProfileLink(bot);
  return {
    https: `${TME}/${bot}?start=${payload}`,
    tg: `tg://resolve?domain=${bot}&start=${payload}`,
  };
}

/**
 * "Add this bot to a group" link.
 * Docs: `t.me/<bot_username>?startgroup=<parameter>` and the valueless
 * `t.me/<bot_username>?startgroup` form, plus their tg:// equivalents.
 *
 * The documented `admin=<permissions>` flag is not generated here: it is a
 * list of requested admin rights rather than a link format, so it is left to
 * the caller to append.
 */
export function buildStartGroupLink(bot: string, payload: string = ''): LinkPair {
  const query = payload ? `startgroup=${payload}` : 'startgroup';
  return { https: `${TME}/${bot}?${query}`, tg: `tg://resolve?domain=${bot}&${query}` };
}

/**
 * Mini App link.
 *
 * With a short name it is a direct Mini App link:
 * `t.me/<bot_username>/<short_name>?startapp=<start_parameter>` /
 * `tg://resolve?domain=<bot_username>&appname=<short_name>&startapp=…`,
 * where the docs mark `startapp` optional. With no payload the parameter is
 * dropped entirely rather than written valueless, because the short name is
 * already what selects the app: `t.me/<bot_username>/<short_name>`.
 *
 * Without a short name it is a Main Mini App link:
 * `t.me/<bot_username>?startapp[=<start_parameter>]` /
 * `tg://resolve?domain=<bot_username>&startapp[=…]`. Here the valueless form
 * *is* documented, and it is load-bearing — it is the only thing separating a
 * Main Mini App link from a plain username link.
 */
export function buildMiniAppLink(
  bot: string,
  appName: string = '',
  payload: string = '',
): LinkPair {
  if (appName) {
    const query = payload ? `?startapp=${payload}` : '';
    const tgQuery = payload ? `&startapp=${payload}` : '';
    return {
      https: `${TME}/${bot}/${appName}${query}`,
      tg: `tg://resolve?domain=${bot}&appname=${appName}${tgQuery}`,
    };
  }
  const query = payload ? `startapp=${payload}` : 'startapp';
  return { https: `${TME}/${bot}?${query}`, tg: `tg://resolve?domain=${bot}&${query}` };
}

/**
 * Share link — opens a chat picker with the url and text pre-filled.
 * Docs: `t.me/share/url?url=<url>&text=<text>` and `tg://msg_url?url=…&text=…`,
 * with "URL to share (urlencoded)".
 */
export function buildShareLink(url: string, text: string = ''): LinkPair {
  const encodedUrl = encodeURIComponent((url ?? '').trim());
  const encodedText = text ? `&text=${encodeURIComponent(text)}` : '';
  return {
    https: `${TME}/share/url?url=${encodedUrl}${encodedText}`,
    tg: `tg://msg_url?url=${encodedUrl}${encodedText}`,
  };
}

/**
 * Phone number link.
 * Docs: `t.me/+<phone_number>` and `tg://resolve?phone=<phone_number>`.
 * Resolves only if the recipient's privacy settings allow being found by
 * phone number — the FAQ says so explicitly.
 */
export function buildPhoneLink(digits: string): LinkPair {
  return { https: `${TME}/+${digits}`, tg: `tg://resolve?phone=${digits}` };
}

/**
 * Link to one post in a public channel or group.
 * Docs: `t.me/<username>/<id>` and `tg://resolve?domain=<username>&post=<id>`.
 */
export function buildPostLink(username: string, messageId: number): LinkPair {
  return {
    https: `${TME}/${username}/${messageId}`,
    tg: `tg://resolve?domain=${username}&post=${messageId}`,
  };
}

/**
 * Link to one post in a private channel or supergroup.
 * Docs: `t.me/c/<channel>/<id>` and
 * `tg://privatepost?channel=<channel>&post=<id>`, where `<channel>` is the id
 * without the Bot API's `-100` prefix.
 *
 * Only members can open it: it addresses a message, it does not grant access.
 */
export function buildPrivatePostLink(internalChannelId: string, messageId: number): LinkPair {
  return {
    https: `${TME}/c/${internalChannelId}/${messageId}`,
    tg: `tg://privatepost?channel=${internalChannelId}&post=${messageId}`,
  };
}

// ---------------------------------------------------------------------------
// Opening a link from a browser
// ---------------------------------------------------------------------------

/**
 * The same link, addressed at the host a browser can actually reach.
 *
 * Every builder here emits the `t.me` host, because that is the string
 * Telegram documents and the one people expect to see when they copy a link.
 * But `t.me` stopped resolving for part of the internet in July 2026, so a
 * link your own code follows — an "Open" button, a redirect, a fetch — should
 * not use it. core.telegram.org/api/links says the host is
 * interchangeable: "Where t.me
 * can also be telegram.me, telegram.dog, and the domain specified in the
 * me_url_prefix field of the global configuration". `telegram.me` is that same
 * destination and it resolves.
 *
 * Only the host is touched, and only when it is exactly `t.me`; a `tg://` link
 * has no host to swap and is returned unchanged.
 */
export function toBrowserLink(url: string): string {
  return (url ?? '').replace(/^(https?:\/\/)t\.me(?=[/?#]|$)/i, '$1telegram.me');
}
