// Serves the same third-party page on two origins: one in the bot's allowlist, one not.
// ?variant= shows the host-page JavaScript API: custom (own button), inline, configure.
// ?lang= sets the page language, which a bot with locale 'auto' follows.
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3100';
const PORTS = [Number(process.env.HOST_PORT ?? 4000), Number(process.env.FOREIGN_PORT ?? 4001)];
const SRC = `${APP_ORIGIN}/api/chat/widget.js?bot=support`;

const VARIANTS = {
  default: `<script src="${SRC}" async></script>`,
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
function identityToken(user, secret = process.env.IDENTITY_SECRET ?? '') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: user.id, name: user.name, aud: 'support', iat: now, exp: now + 600 };
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

/** Signs Ada in before the chat loads; `forged` signs with a secret the app doesn't know. */
const identityVariant = (forged) => {
  const ada = { id: 'user-ada', name: 'Ada Lovelace' };
  const token = forged
    ? identityToken(ada, 'a-secret-the-attacker-made-up-1234567890')
    : identityToken(ada);
  return `<script>
      window.askdare = window.askdare || function () {
        (window.askdare.q = window.askdare.q || []).push(arguments);
      };
      window.askdare('identify', '${token}');
    </script>
    <script src="${SRC}" async></script>`;
};

const body = (variant) =>
  variant === 'identity' || variant === 'forged'
    ? identityVariant(variant === 'forged')
    : (VARIANTS[variant] ?? VARIANTS.default);

const page = (port, variant, lang) => `<!doctype html>
<html${lang === 'none' ? '' : ` lang="${lang}"`}>
  <head><meta charset="utf-8"><title>Host page ${port}</title></head>
  <body>
    <h1>A third-party website on port ${port}</h1>
    ${body(variant)}
  </body>
</html>`;

for (const port of PORTS) {
  createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://host');
    if (url.pathname !== '/') {
      response.writeHead(404).end();
      return;
    }
    const lang = /^([a-z]{2}(-[A-Z]{2})?|none)$/.test(url.searchParams.get('lang') ?? '')
      ? url.searchParams.get('lang')
      : 'en';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page(port, url.searchParams.get('variant') ?? 'default', lang));
  }).listen(port, '127.0.0.1', () => console.log(`host page on http://127.0.0.1:${port}`));
}
