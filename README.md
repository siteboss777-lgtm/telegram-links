# telegram-links

Builds and validates the `t.me` and `tg://` link formats that Telegram documents, as pure string functions with no dependencies and no network access.

Every format is taken from a line in Telegram's own documentation, and each builder's comment names the page it came from. This matters more than it sounds: an almost-right deep link fails silently — the client opens the chat and drops the payload — so a generator that guesses is worse than no generator.

## Install

```sh
npm install telegram-links
```

Node 20 or newer. ES modules only.

## Usage

Every builder returns a pair: the `https` form, which works anywhere a URL works (a browser, a QR code, an email), and the `tg://` form documented beside it, which skips the redirect page but only resolves where Telegram is installed.

```js
import {
  buildBotStartLink,
  buildPrivatePostLink,
  buildShareLink,
  toInternalChannelId,
  normalizeUsername,
  validateUsername,
} from 'telegram-links';
```

A bot deep link carrying a `start` payload:

```js
buildBotStartLink('your_bot', 'promo42');
// {
//   https: 'https://t.me/your_bot?start=promo42',
//   tg:    'tg://resolve?domain=your_bot&start=promo42'
// }
```

A link to one post in a private channel, from the `-100`-prefixed chat id the Bot
API hands you. The `t.me/c/` form uses the id without that prefix:

```js
const channel = toInternalChannelId('-1001234567890');
// '1234567890'

buildPrivatePostLink(channel, 45);
// {
//   https: 'https://t.me/c/1234567890/45',
//   tg:    'tg://privatepost?channel=1234567890&post=45'
// }
```

A share link. The url is percent-encoded, so a query string inside it survives
intact — an unencoded `&` would end the `url` parameter and hand the rest to
Telegram as a separate argument:

```js
buildShareLink('https://example.com/a?b=1&c=2', 'Look at this');
// {
//   https: 'https://t.me/share/url?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2&text=Look%20at%20this',
//   tg:    'tg://msg_url?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2&text=Look%20at%20this'
// }
```

A username that must be rejected. `t.me/share` is a live route, so treating
`share` as a channel would produce a link that opens something — a failure that
looks like a success. The reserved list comes from the names a `<username>.t.me`
subdomain is documented not to resolve as:

```js
normalizeUsername('https://t.me/share');
// 'share'
validateUsername('share');
// 'username'   (the error code for this field)

validateUsername(normalizeUsername('  @Durov  '));
// null         (null means valid)
```

`normalizeUsername` accepts `@name`, `name`, `t.me/name`, `https://t.me/name/`,
the `telegram.me` and `telegram.dog` hosts, the `name.t.me` subdomain form, and
`tg://resolve?domain=name` as copied out of a desktop client.

## Link types

| Type | Builder | `https` form | Telegram docs |
| --- | --- | --- | --- |
| profile | `buildProfileLink` | `t.me/<username>` | [Public username links](https://core.telegram.org/api/links#public-username-links) |
| bot | `buildBotStartLink` | `t.me/<bot_username>?start=<parameter>` | [Bot links](https://core.telegram.org/api/links#bot-links) |
| startgroup | `buildStartGroupLink` | `t.me/<bot_username>?startgroup=<parameter>` | [Group/channel bot links](https://core.telegram.org/api/links#group-channel-bot-links) |
| miniapp | `buildMiniAppLink` | `t.me/<bot_username>/<short_name>?startapp=<parameter>` | [Direct mini app links](https://core.telegram.org/api/links#direct-mini-app-links), [Main Mini App links](https://core.telegram.org/api/links#main-mini-app-links) |
| share | `buildShareLink` | `t.me/share/url?url=<url>&text=<text>` | [Share links](https://core.telegram.org/api/links#share-links) |
| phone | `buildPhoneLink` | `t.me/+<phone_number>` | [Phone number links](https://core.telegram.org/api/links#phone-number-links) |
| post | `buildPostLink` | `t.me/<username>/<id>` | [Message links](https://core.telegram.org/api/links#message-links) |
| privatepost | `buildPrivatePostLink` | `t.me/c/<channel>/<id>` | [Message links](https://core.telegram.org/api/links#message-links) |

The bot username rules (5–32 characters, Latin letters, digits and underscores,
ending in `bot`) and the 64-character `start` parameter come from
[Bot features](https://core.telegram.org/bots/features). The username character
set is also stated in the [Telegram FAQ](https://telegram.org/faq).

## Validation

Each validator returns `null` when the value is usable, or a short error code
naming the field: `validateUsername`, `validateBotUsername`,
`validateStartPayload`, `validateAppName`, `validateShareUrl`, `validatePhone`.
One code per field rather than one per failure mode, because the message worth
showing states the whole rule, not which half of it was broken.

`normalizeUsername`, `normalizePhone`, `toInternalChannelId` and
`parseMessageId` turn pasted input into the shape the builders expect.

`toBrowserLink` swaps the host on an `https://t.me/...` string to
`https://telegram.me/...` for links your own code has to follow rather than
display. The docs state the hosts are interchangeable: "Where t.me can also be
telegram.me, telegram.dog, and the domain specified in the me_url_prefix field
of the global configuration"
([Deep links](https://core.telegram.org/api/links)). Builders always emit `t.me`,
because that is the string Telegram documents and the one people recognise.

## What this does not do

It does not create invite links for private chats. Those are not a link format
you can assemble from parts — they contain a hash issued by Telegram, generated
with `messages.exportChatInvite`
([Invite links](https://core.telegram.org/api/invites)). This package can only
format links whose pieces you already hold.

It does not call any API. There is no token, no fetch, no network access
anywhere in the module; every function is a string in, a string out. Nothing is
checked for existence either — validation here is syntax only, so a
syntactically perfect link to a username nobody registered is still a perfect
link to nothing.

It does not emit the documented `admin=<permissions>` flag on `startgroup`
links, and it does not build the many other formats listed on the Deep links
page (stickersets, themes, proxies, invoices, boosts and the rest) — only the
eight in the table above.

---

A hosted version of these generators runs at [adminhub.tools/tools/telegram-link-generator](https://adminhub.tools/tools/telegram-link-generator/).

## License

MIT
