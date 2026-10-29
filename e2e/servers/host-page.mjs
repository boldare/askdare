// Serves the same third-party page on two origins: one in the bot's allowlist, one not.
import { createServer } from 'node:http';

const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3100';
const PORTS = [Number(process.env.HOST_PORT ?? 4000), Number(process.env.FOREIGN_PORT ?? 4001)];

const page = (port) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Host page ${port}</title></head>
  <body>
    <h1>A third-party website on port ${port}</h1>
    <script src="${APP_ORIGIN}/api/chat/widget.js" data-bot="support" async></script>
  </body>
</html>`;

for (const port of PORTS) {
  createServer((request, response) => {
    if (request.url !== '/') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page(port));
  }).listen(port, '127.0.0.1', () => console.log(`host page on http://127.0.0.1:${port}`));
}
