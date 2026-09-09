// npm test  ->  tsc, then `node --test dist/test/`.
//
// The suite imports the module by relative path only: it must stay runnable
// with nothing installed but TypeScript itself.
//
// The assertions below are written against Telegram's documented syntax, not
// against the implementation: every expected string is the doc's own template
// with the placeholders filled in. If a builder ever "improves" a format, that
// is a regression and these fail.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOT_USERNAME_MIN,
  LINK_TYPES,
  PHONE_MAX_DIGITS,
  PHONE_MIN_DIGITS,
  START_PAYLOAD_MAX,
  USERNAME_MAX,
  buildBotStartLink,
  buildMiniAppLink,
  buildPhoneLink,
  buildPostLink,
  buildPrivatePostLink,
  buildProfileLink,
  buildShareLink,
  buildStartGroupLink,
  normalizePhone,
  normalizeUsername,
  RESERVED_USERNAMES,
  parseMessageId,
  toBrowserLink,
  toInternalChannelId,
  validateAppName,
  validateBotUsername,
  validatePhone,
  validateShareUrl,
  validateStartPayload,
  validateUsername,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

test('the documented limits are the ones in the code', () => {
  assert.equal(USERNAME_MAX, 32);
  assert.equal(BOT_USERNAME_MIN, 5);
  assert.equal(START_PAYLOAD_MAX, 64);
  assert.equal(PHONE_MIN_DIGITS, 6);
  assert.equal(PHONE_MAX_DIGITS, 15);
  assert.equal(LINK_TYPES.length, 8);
});

// ---------------------------------------------------------------------------
// normalizeUsername
// ---------------------------------------------------------------------------

test('normalizeUsername unwraps every shape a reader can paste', () => {
  const cases: Array<[string, string]> = [
    ['durov', 'durov'],
    ['@durov', 'durov'],
    ['  @durov  ', 'durov'],
    ['t.me/durov', 'durov'],
    ['T.ME/Durov', 'Durov'],
    ['http://t.me/durov', 'durov'],
    ['https://t.me/durov', 'durov'],
    ['https://t.me/durov/', 'durov'],
    ['https://www.t.me/durov', 'durov'],
    ['https://telegram.me/durov', 'durov'],
    ['https://telegram.dog/durov', 'durov'],
    ['durov.t.me', 'durov'],
    ['https://durov.t.me/', 'durov'],
    ['https://t.me/durov?start=abc', 'durov'],
    ['https://t.me/durov/123', 'durov'],
    ['https://t.me/@durov', 'durov'],
    ['tg://resolve?domain=durov', 'durov'],
    ['tg://resolve?domain=durov&start=abc', 'durov'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeUsername(input), expected, `input: ${input}`);
  }
});

test('normalizeUsername preserves capitalisation and rejects nothing itself', () => {
  // Usernames are case-insensitive but Telegram stores the capitalisation, so
  // the normaliser must not lowercase — the link should read the way the owner
  // writes it. Validation is a separate step.
  assert.equal(normalizeUsername('My_Shop_Bot'), 'My_Shop_Bot');
  assert.equal(normalizeUsername(''), '');
  assert.equal(normalizeUsername('   '), '');
  assert.equal(normalizeUsername('not a username!'), 'not a username!');
});

// ---------------------------------------------------------------------------
// validateUsername / validateBotUsername
// ---------------------------------------------------------------------------

test('validateUsername accepts the documented character set', () => {
  for (const name of ['durov', 'a_b_c', 'Test123', 'x'.repeat(USERNAME_MAX)]) {
    assert.equal(validateUsername(name), null, `should accept ${name}`);
  }
});

test('validateUsername rejects empty, over-long and non-Latin handles', () => {
  for (const name of ['', 'x'.repeat(USERNAME_MAX + 1), 'ann-marie', 'дуров', 'a b', 'name@x']) {
    assert.equal(validateUsername(name), 'username', `should reject ${JSON.stringify(name)}`);
  }
});

test('validateUsername allows short handles — collectible usernames are real', () => {
  // The 5-character minimum is documented for BOT usernames only. Enforcing it
  // on channels would reject a Fragment-bought short handle.
  assert.equal(validateUsername('shop'), null);
  assert.equal(validateBotUsername('shop'), 'botUsername');
});

test('validateBotUsername enforces length, character set and the bot suffix', () => {
  assert.equal(validateBotUsername('tetris_bot'), null);
  assert.equal(validateBotUsername('TetrisBot'), null); // suffix is case-insensitive
  assert.equal(validateBotUsername('mybot'), null); // exactly 5
  assert.equal(validateBotUsername('abot'), 'botUsername'); // 4 chars
  assert.equal(validateBotUsername('my_store'), 'botUsername'); // no bot suffix
  assert.equal(validateBotUsername('my-bot'), 'botUsername'); // hyphen
  assert.equal(validateBotUsername(''), 'botUsername');
});

// ---------------------------------------------------------------------------
// validateStartPayload / validateAppName
// ---------------------------------------------------------------------------

test('validateStartPayload follows the 64-character base64url rule', () => {
  assert.equal(validateStartPayload(''), null, 'the parameter is optional');
  assert.equal(validateStartPayload('airplane'), null);
  assert.equal(validateStartPayload('ref-42_A'), null);
  assert.equal(validateStartPayload('x'.repeat(START_PAYLOAD_MAX)), null);
  assert.equal(validateStartPayload('x'.repeat(START_PAYLOAD_MAX + 1)), 'payload');
  assert.equal(validateStartPayload('has space'), 'payload');
  assert.equal(validateStartPayload('a=b'), 'payload');
  assert.equal(validateStartPayload('utm/source'), 'payload');
  assert.equal(validateStartPayload('привет'), 'payload');
});

test('validateAppName checks characters but invents no length rule', () => {
  assert.equal(validateAppName(''), null);
  assert.equal(validateAppName('shop'), null);
  assert.equal(validateAppName('my_app_2'), null);
  assert.equal(validateAppName('x'.repeat(200)), null, 'no documented maximum to enforce');
  assert.equal(validateAppName('my-app'), 'appName');
  assert.equal(validateAppName('my app'), 'appName');
});

// ---------------------------------------------------------------------------
// Phone, message id, channel id
// ---------------------------------------------------------------------------

test('normalizePhone keeps digits and drops the typography', () => {
  assert.equal(normalizePhone('+34 600 123 456'), '34600123456');
  assert.equal(normalizePhone('+1 (234) 567-89-00'), '12345678900');
  assert.equal(normalizePhone(''), '');
});

test('validatePhone holds the E.164 bounds', () => {
  assert.equal(validatePhone('34600123456'), null);
  assert.equal(validatePhone('1'.repeat(PHONE_MIN_DIGITS)), null);
  assert.equal(validatePhone('1'.repeat(PHONE_MAX_DIGITS)), null);
  assert.equal(validatePhone('1'.repeat(PHONE_MIN_DIGITS - 1)), 'phone');
  assert.equal(validatePhone('1'.repeat(PHONE_MAX_DIGITS + 1)), 'phone');
  assert.equal(validatePhone(''), 'phone');
});

test('parseMessageId takes a positive integer and nothing else', () => {
  assert.equal(parseMessageId('1234'), 1234);
  assert.equal(parseMessageId(' 1 234 '), 1234);
  assert.equal(parseMessageId('1,234'), 1234);
  assert.equal(parseMessageId('0'), null);
  assert.equal(parseMessageId('-5'), null);
  assert.equal(parseMessageId('12.5'), null);
  assert.equal(parseMessageId('abc'), null);
  assert.equal(parseMessageId(''), null);
});

test('toInternalChannelId strips the Bot API -100 prefix', () => {
  assert.equal(toInternalChannelId('-1001234567890'), '1234567890');
  assert.equal(toInternalChannelId(' -100 1234567890 '), '1234567890');
  assert.equal(toInternalChannelId('1234567890'), '1234567890', 'already internal');
  assert.equal(toInternalChannelId('-1234567890'), '1234567890', 'plain negative id');
  assert.equal(toInternalChannelId('-100100'), '100', 'the prefix, then a short id');
  assert.equal(
    toInternalChannelId('-100'),
    '100',
    'nothing follows the prefix, so this is read as the plain id -100',
  );
  assert.equal(toInternalChannelId('abc'), null);
  assert.equal(toInternalChannelId('0'), null);
  assert.equal(toInternalChannelId(''), null);
});

// ---------------------------------------------------------------------------
// Builders — every expected string is the documented template, filled in
// ---------------------------------------------------------------------------

test('buildProfileLink: t.me/<username> and tg://resolve?domain=<username>', () => {
  assert.deepEqual(buildProfileLink('durov'), {
    https: 'https://t.me/durov',
    tg: 'tg://resolve?domain=durov',
  });
});

test('buildBotStartLink: ?start=<parameter>, or the plain username link without one', () => {
  assert.deepEqual(buildBotStartLink('your_bot', 'airplane'), {
    https: 'https://t.me/your_bot?start=airplane',
    tg: 'tg://resolve?domain=your_bot&start=airplane',
  });
  assert.deepEqual(buildBotStartLink('your_bot'), {
    https: 'https://t.me/your_bot',
    tg: 'tg://resolve?domain=your_bot',
  });
});

test('buildStartGroupLink: ?startgroup=<parameter>, and the valueless form', () => {
  assert.deepEqual(buildStartGroupLink('your_bot', 'spaceship'), {
    https: 'https://t.me/your_bot?startgroup=spaceship',
    tg: 'tg://resolve?domain=your_bot&startgroup=spaceship',
  });
  assert.deepEqual(buildStartGroupLink('your_bot'), {
    https: 'https://t.me/your_bot?startgroup',
    tg: 'tg://resolve?domain=your_bot&startgroup',
  });
});

test('buildMiniAppLink: direct link with a short name, main Mini App without', () => {
  assert.deepEqual(buildMiniAppLink('your_bot', 'shop', 'promo42'), {
    https: 'https://t.me/your_bot/shop?startapp=promo42',
    tg: 'tg://resolve?domain=your_bot&appname=shop&startapp=promo42',
  });
  // Deliberately not `?startapp`.
  // core.telegram.org/api/links documents the valueless `startapp` under Main
  // Mini App links, where it is what distinguishes the link from a plain
  // username link. A direct Mini App link is already distinguished by its
  // short name, and the docs mark `startapp` optional there — so with no
  // payload there is nothing to write.
  assert.deepEqual(buildMiniAppLink('your_bot', 'shop'), {
    https: 'https://t.me/your_bot/shop',
    tg: 'tg://resolve?domain=your_bot&appname=shop',
  });
  assert.deepEqual(buildMiniAppLink('your_bot', '', 'promo42'), {
    https: 'https://t.me/your_bot?startapp=promo42',
    tg: 'tg://resolve?domain=your_bot&startapp=promo42',
  });
  assert.deepEqual(buildMiniAppLink('your_bot'), {
    https: 'https://t.me/your_bot?startapp',
    tg: 'tg://resolve?domain=your_bot&startapp',
  });
});

test('buildPhoneLink: t.me/+<digits> and tg://resolve?phone=<digits>', () => {
  assert.deepEqual(buildPhoneLink('34600123456'), {
    https: 'https://t.me/+34600123456',
    tg: 'tg://resolve?phone=34600123456',
  });
});

// ---------------------------------------------------------------------------
// Draft text — the WhatsApp-style "write to me" link with a message pre-typed
// ---------------------------------------------------------------------------

test('buildProfileLink with draft text: t.me/<username>?text=<draft_text> and tg://resolve?domain=<username>&text=<draft_text>', () => {
  assert.deepEqual(buildProfileLink('durov', 'Olá, vim pelo site'), {
    https: 'https://t.me/durov?text=Ol%C3%A1%2C%20vim%20pelo%20site',
    tg: 'tg://resolve?domain=durov&text=Ol%C3%A1%2C%20vim%20pelo%20site',
  });
});

test('buildPhoneLink with draft text: t.me/+<phone_number>?text=<draft_text> and tg://resolve?phone=<phone_number>&text=<draft_text>', () => {
  assert.deepEqual(buildPhoneLink('5511987654321', 'Oi! Quero saber mais'), {
    https: 'https://t.me/+5511987654321?text=Oi!%20Quero%20saber%20mais',
    tg: 'tg://resolve?phone=5511987654321&text=Oi!%20Quero%20saber%20mais',
  });
});

test('an empty or blank draft leaves the plain link untouched', () => {
  assert.deepEqual(buildProfileLink('durov', ''), buildProfileLink('durov'));
  assert.deepEqual(buildProfileLink('durov', '   '), buildProfileLink('durov'));
  assert.deepEqual(buildPhoneLink('34600123456', ''), buildPhoneLink('34600123456'));
});

test('draft text encodes the characters that would end or break the query', () => {
  // `&` would start a second parameter, `#` a fragment, `+` reads as a space
  // on the receiving side, `?` must not open a second query.
  const link = buildProfileLink('durov', 'a&b#c+d?e');
  assert.equal(link.https, 'https://t.me/durov?text=a%26b%23c%2Bd%3Fe');
  assert.equal(link.tg, 'tg://resolve?domain=durov&text=a%26b%23c%2Bd%3Fe');
});

test('buildPostLink: t.me/<username>/<id> and tg://resolve?domain=…&post=<id>', () => {
  assert.deepEqual(buildPostLink('durov', 123), {
    https: 'https://t.me/durov/123',
    tg: 'tg://resolve?domain=durov&post=123',
  });
});

test('buildPrivatePostLink: t.me/c/<channel>/<id> and tg://privatepost', () => {
  assert.deepEqual(buildPrivatePostLink('1234567890', 45), {
    https: 'https://t.me/c/1234567890/45',
    tg: 'tg://privatepost?channel=1234567890&post=45',
  });
});

test('a pasted Bot API chat id reaches the private post link intact', () => {
  const internal = toInternalChannelId('-1001234567890');
  assert.ok(internal);
  assert.equal(
    buildPrivatePostLink(internal, 45).https,
    'https://t.me/c/1234567890/45',
  );
});

// ---------------------------------------------------------------------------
// Encoding — the one place where a wrong character silently breaks the link
// ---------------------------------------------------------------------------

test('buildShareLink percent-encodes the url and the text', () => {
  assert.deepEqual(buildShareLink('https://example.com/shop/', 'Look at this'), {
    https: 'https://t.me/share/url?url=https%3A%2F%2Fexample.com%2Fshop%2F&text=Look%20at%20this',
    tg: 'tg://msg_url?url=https%3A%2F%2Fexample.com%2Fshop%2F&text=Look%20at%20this',
  });
});

test('buildShareLink survives a query string in the shared url', () => {
  // The killer case: an un-encoded `&` inside `url` would end the parameter and
  // hand the rest of the campaign tag to Telegram as a separate argument.
  const link = buildShareLink('https://example.com/a?b=1&c=2#top');
  assert.equal(
    link.https,
    'https://t.me/share/url?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2%23top',
  );
  assert.ok(!link.https.includes('&c=2'), 'the ampersand must not survive raw');
  assert.equal(link.tg, 'tg://msg_url?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2%23top');
});

test('buildShareLink encodes non-Latin text and emoji', () => {
  const link = buildShareLink('https://example.com/', 'Привет 👋');
  assert.equal(
    link.https,
    'https://t.me/share/url?url=https%3A%2F%2Fexample.com%2F&text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%F0%9F%91%8B',
  );
  assert.equal(decodeURIComponent(link.https.split('&text=')[1]), 'Привет 👋');
});

test('buildShareLink omits text entirely when there is none', () => {
  const link = buildShareLink('https://example.com/');
  assert.ok(!link.https.includes('text='));
  assert.ok(!link.tg.includes('text='));
});

test('validateShareUrl wants an absolute http(s) address', () => {
  assert.equal(validateShareUrl('https://example.com/'), null);
  assert.equal(validateShareUrl('http://example.com/a?b=1'), null);
  assert.equal(validateShareUrl(' https://example.com '), null);
  assert.equal(validateShareUrl(''), 'url');
  assert.equal(validateShareUrl('example.com'), 'url');
  assert.equal(validateShareUrl('/shop/'), 'url');
  assert.equal(validateShareUrl('javascript:alert(1)'), 'url');
});

// ---------------------------------------------------------------------------
// A guard for the whole surface
// ---------------------------------------------------------------------------

test('no builder ever emits a space or a raw newline', () => {
  const pairs = [
    buildProfileLink('durov'),
    buildBotStartLink('your_bot', 'a-b_C'),
    buildStartGroupLink('your_bot', 'spaceship'),
    buildMiniAppLink('your_bot', 'shop', 'promo42'),
    buildShareLink('https://example.com/a b', 'two words'),
    buildPhoneLink('34600123456'),
    buildProfileLink('durov', 'two words'),
    buildPhoneLink('34600123456', 'olá  mundo\n'),
    buildPostLink('durov', 1),
    buildPrivatePostLink('1234567890', 1),
  ];
  console.log(`  checked ${pairs.length * 2} generated links for whitespace`);
  for (const pair of pairs) {
    for (const link of [pair.https, pair.tg]) {
      assert.ok(!/\s/.test(link), `whitespace in ${link}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Malformed input must not take the caller down with it
// ---------------------------------------------------------------------------

test('normalizeUsername survives a broken percent-escape instead of throwing', () => {
  // `decodeURIComponent` throws URIError on all four of these. The input is
  // whatever a user pasted, so an unguarded throw would turn a typo into an
  // exception on a code path that has no other way to fail. Every case must
  // come back as an ordinary string that the validator then rejects in the
  // ordinary way.
  const broken = [
    'tg://resolve?domain=%',
    'tg://resolve?domain=abc%',
    'tg://resolve?domain=%zz',
    'tg://resolve?domain=%E0%A4', // valid bytes, incomplete UTF-8 sequence
  ];
  console.log(`  checked ${broken.length} malformed tg:// pastes`);
  for (const input of broken) {
    const handle = normalizeUsername(input);
    assert.equal(typeof handle, 'string', `input: ${input}`);
    assert.equal(validateUsername(handle), 'username', `input: ${input}`);
  }
});

test('normalizeUsername still decodes an escape that is actually valid', () => {
  assert.equal(normalizeUsername('tg://resolve?domain=%40durov'), 'durov');
  assert.equal(normalizeUsername('tg://resolve?domain=my%5Fbot'), 'my_bot');
});

// ---------------------------------------------------------------------------
// Reserved path segments
// ---------------------------------------------------------------------------

test('validateUsername rejects the segments t.me spends on something else', () => {
  // core.telegram.org/api/links lists these as names a `<username>.t.me` link
  // must not be treated as; `t.me/share` and `t.me/c/…` are live routes, so a
  // generated "channel link" pointing at one of them opens something that is
  // not the channel — a failure that looks like a success.
  for (const name of ['share', 'c', 'joinchat', 'proxy', 'a', 'k', 'z', 'SHARE', 'Joinchat']) {
    assert.equal(validateUsername(name), 'username', `should reject ${name}`);
  }
  console.log(`  ${RESERVED_USERNAMES.length} reserved segments in the list`);
  for (const name of RESERVED_USERNAMES) {
    assert.equal(validateUsername(name), 'username', `should reject ${name}`);
  }
  // And nothing else got caught in the net.
  assert.equal(validateUsername('sharehouse'), null);
  assert.equal(validateUsername('durov'), null);
});

// ---------------------------------------------------------------------------
// The host this page itself opens
// ---------------------------------------------------------------------------

test('toBrowserLink swaps only the t.me host, and only for web links', () => {
  assert.equal(toBrowserLink('https://t.me/durov'), 'https://telegram.me/durov');
  assert.equal(
    toBrowserLink('https://t.me/your_bot?start=promo42'),
    'https://telegram.me/your_bot?start=promo42',
  );
  assert.equal(toBrowserLink('https://t.me/c/1234567890/45'), 'https://telegram.me/c/1234567890/45');
  // Not a t.me link: nothing to swap.
  assert.equal(toBrowserLink('tg://resolve?domain=durov'), 'tg://resolve?domain=durov');
  assert.equal(toBrowserLink('https://example.com/t.me/x'), 'https://example.com/t.me/x');
  // The host must match exactly — a lookalike domain is left alone.
  assert.equal(toBrowserLink('https://not-t.me/durov'), 'https://not-t.me/durov');
});

test('what the reader copies is untouched: builders still emit t.me', () => {
  // The swap belongs to the Open button only. If a builder ever starts
  // emitting telegram.me, this fails — the copied string is the one Telegram
  // documents and the one readers expect to recognise.
  const built = [
    buildProfileLink('durov').https,
    buildBotStartLink('your_bot', 'promo42').https,
    buildMiniAppLink('your_bot', 'shop').https,
    buildPhoneLink('34600123456').https,
    buildPostLink('durov', 1).https,
    buildPrivatePostLink('1234567890', 1).https,
    buildShareLink('https://example.com/').https,
  ];
  console.log(`  checked ${built.length} generated web links for the documented host`);
  for (const link of built) {
    assert.ok(link.startsWith('https://t.me/'), `expected the documented host: ${link}`);
  }
});
