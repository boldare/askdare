// Serves the same third-party page on two origins: one in the bot's allowlist, one not.
// ?variant= shows the host-page JavaScript API: custom (own button), inline, configure.
// ?lang= sets the page language, which a bot with locale 'auto' follows.
import { createServer } from 'node:http';

const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3100';
const PORTS = [Number(process.env.HOST_PORT ?? 4000), Number(process.env.FOREIGN_PORT ?? 4001)];
const SRC = `${APP_ORIGIN}/api/chat/widget.js?bot=support`;

const VARIANTS = {
  default: `<script src="${SRC}" async></script>`,
  custom: `<button id="ask" type="button">Chat with us</button>
    <script src="${SRC}" data-launcher="none" async></script>
    <script>document.getElementById('ask').addEventListener('click', () => window.chatdock('open'));</script>`,
  inline: `<div id="chat" style="width: 380px; height: 600px; border: 1px solid #ddd"></div>
    <script src="${SRC}" data-mode="inline" data-target="#chat" async></script>`,
  queued: `<script>
      window.chatdock = window.chatdock || function () {
        (window.chatdock.q = window.chatdock.q || []).push(arguments);
      };
      window.chatdock('configure', { greeting: 'Queued before the script loaded.' });
    </script>
    <script src="${SRC}" async></script>`,
  tall: `<div style="height: 2000px">Content above the chat</div>
    <div id="chat" style="width: 380px; height: 600px"></div>
    <script src="${SRC}" data-mode="inline" data-target="#chat" async></script>`,
  configure: `<script id="loader" src="${SRC}" async></script>
    <script>
      document.getElementById('loader').addEventListener('load', () => {
        window.chatdock('configure', {
          greeting: 'Questions about our prices?',
          starters: ['How much is the Business plan?'],
          context: 'Pricing page listing the Free, Team and Business plans.',
          model: 'not-allowed',
        });
      });
    </script>`,
};

const page = (port, variant, lang) => `<!doctype html>
<html${lang === 'none' ? '' : ` lang="${lang}"`}>
  <head><meta charset="utf-8"><title>Host page ${port}</title></head>
  <body>
    <h1>A third-party website on port ${port}</h1>
    ${VARIANTS[variant] ?? VARIANTS.default}
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
