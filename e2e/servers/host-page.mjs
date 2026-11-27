// Serves the same third-party page on two origins: one in the bot's allowlist, one not.
// ?variant= shows the host-page JavaScript API: custom (own button), inline, configure,
// follow-lang (the chat follows the page's language), trusted-types (the default page, sent with a
// CSP that enforces Trusted Types), greeting-off (data-greeting="off").
// ?lang= sets the page language, which a bot with locale 'auto' follows.
// ?bot=own-page embeds the bot whose iframe shows the site's own page (embedPath, ADR-0018).
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3100';
const PORTS = [Number(process.env.HOST_PORT ?? 4000), Number(process.env.FOREIGN_PORT ?? 4001)];
const SRC = `${APP_ORIGIN}/api/chat/widget.js?bot=support`;
const BOTS = ['support', 'own-page'];

const VARIANTS = {
  default: `<script src="${SRC}" async></script>`,
  // The default page; the server adds `require-trusted-types-for 'script'` (ADR-0033).
  'trusted-types': `<script src="${SRC}" async></script>`,
  // The page turns the greeting next to the launcher off (ADR-0033).
  'greeting-off': `<script src="${SRC}" data-greeting="off" async></script>`,
  custom: `<button id="ask" type="button">Chat with us</button>
    <script src="${SRC}" data-launcher="none" async></script>
    <script>document.getElementById('ask').addEventListener('click', () => window.askdare('open'));</script>`,
  inline: `<div id="chat" style="width: 380px; height: 600px; border: 1px solid #ddd"></div>
    <script src="${SRC}" data-mode="inline" data-target="#chat" async></script>`,
  // A blocking script before its target: the loader has to wait for the page.
  early: `<script src="${SRC}" data-mode="inline" data-target="#chat"></script>
    <div id="chat" style="width: 380px; height: 600px; border: 1px solid #ddd"></div>`,
  // The same, with a stub call made while the loader waits for the page.
  'early-queued': `<script>
      window.askdare = window.askdare || function () {
        (window.askdare.q = window.askdare.q || []).push(arguments);
      };
    </script>
    <script src="${SRC}" data-mode="inline" data-target="#chat"></script>
    <script>window.askdare('configure', { greeting: 'Configured while the page loaded.' });</script>
    <div id="chat" style="width: 380px; height: 600px; border: 1px solid #ddd"></div>`,
  queued: `<script>
      window.askdare = window.askdare || function () {
        (window.askdare.q = window.askdare.q || []).push(arguments);
      };
      window.askdare('configure', { greeting: 'Queued before the script loaded.' });
    </script>
    <script src="${SRC}" async></script>`,
  tall: `<div style="height: 2000px">Content above the chat</div>
    <div id="chat" style="width: 380px; height: 600px"></div>
    <script src="${SRC}" data-mode="inline" data-target="#chat" async></script>`,
  // Records the chat's events, registered through the stub before the script loads (ADR-0013).
  events: `<script>
      window.askdare = window.askdare || function () {
        (window.askdare.q = window.askdare.q || []).push(arguments);
      };
      window.events = [];
      window.askdare('on', '*', (event) => window.events.push(event));
    </script>
    <script src="${SRC}" async></script>`,
  // Follows <html lang> and records the chat's events, for switching the language (ADR-0014).
  'follow-lang': `<script>
      window.askdare = window.askdare || function () {
        (window.askdare.q = window.askdare.q || []).push(arguments);
      };
      window.events = [];
      window.askdare('on', '*', (event) => window.events.push(event));
    </script>
    <script src="${SRC}" data-follow-lang async></script>`,
  configure: `<script id="loader" src="${SRC}" async></script>
    <script>
      document.getElementById('loader').addEventListener('load', () => {
        window.askdare('configure', {
          greeting: 'Questions about our prices?',
          starters: ['How much is the Business plan?'],
          context: 'Pricing page listing the Free, Team and Business plans.',
          model: 'not-allowed',
        });
      });
    </script>`,
};

/** What a site's backend does to sign a visitor in: an HS256 JWT with IDENTITY_SECRET (ADR-0009). */
function identityToken(user, bot, secret = process.env.IDENTITY_SECRET ?? '') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: user.id, name: user.name, aud: bot, iat: now, exp: now + 600 };
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

/** Signs Ada in before the chat loads; `forged` signs with a secret the app doesn't know. */
const identityVariant = (forged, bot) => {
  const ada = { id: 'user-ada', name: 'Ada Lovelace' };
  const token = forged
    ? identityToken(ada, bot, 'a-secret-the-attacker-made-up-1234567890')
    : identityToken(ada, bot);
  return `<script>
      window.askdare = window.askdare || function () {
        (window.askdare.q = window.askdare.q || []).push(arguments);
      };
      window.askdare('identify', '${token}');
    </script>
    <script src="${SRC}" async></script>`;
};

const body = (variant, bot) =>
  (variant === 'identity' || variant === 'forged'
    ? identityVariant(variant === 'forged', bot)
    : (VARIANTS[variant] ?? VARIANTS.default)
  ).replaceAll(SRC, `${APP_ORIGIN}/api/chat/widget.js?bot=${bot}`);

const page = (port, variant, lang, bot) => `<!doctype html>
<html${lang === 'none' ? '' : ` lang="${lang}"`}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Host page ${port}</title>
  </head>
  <body>
    <h1>A third-party website on port ${port}</h1>
    ${body(variant, bot)}
  </body>
</html>`;

for (const port of PORTS) {
  createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://host');
    if (url.pathname !== '/') {
      response.writeHead(404).end();
      return;
    }
    // What goes into the page's HTML is checked or one of our own names, never the query's text.
    const asked = url.searchParams.get('lang') ?? '';
    const lang = /^([a-z]{2}(-[A-Z]{2})?|none)$/.test(asked) ? asked : 'en';
    const bot = BOTS.find((name) => name === url.searchParams.get('bot')) ?? 'support';
    const variant =
      [...Object.keys(VARIANTS), 'identity', 'forged'].find(
        (name) => name === url.searchParams.get('variant'),
      ) ?? 'default';
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      ...(variant === 'trusted-types'
        ? { 'content-security-policy': "require-trusted-types-for 'script'" }
        : {}),
    });
    response.end(page(port, variant, lang, bot));
  }).listen(port, '127.0.0.1', () => console.log(`host page on http://127.0.0.1:${port}`));
}
