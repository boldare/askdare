// A host page and a fake chat iframe, to check the measured greeting and badge in a browser.
// Serves the variant "lean +bubble +badge(attr)" built by measure.mjs. Usage: node demo/serve.mjs
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4610);
const look = {
  style: 'pill',
  texts: {
    en: {
      label: 'Ask us', open: 'Open chat', close: 'Close chat', title: 'Assistant',
      unavailable: 'The chat couldn’t load. Please try again later.',
      greeting: 'Hi! I’m the AI assistant. Any questions?', dismiss: 'Dismiss greeting', unread: 'new messages',
    },
  },
  accent: '#1f5fe0', onAccent: '#ffffff', orb: '#1f5fe0', initials: 'AS', light: '#ffffff',
  dark: '#0a0f1c', text: '#0d1526', textDark: '#e8edf7', scheme: 'auto', radius: '18px', greet: 1500,
};

const host = (attrs) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Host</title>
<body><h1>Host page</h1><p><a href="/">Reload</a> · <a href="/?off">With data-greeting="off"</a></p>
<button id="page-button">A page button</button>
<script>window.events = []; window.askdare = function () { (window.askdare.q = window.askdare.q || []).push([...arguments]); };
askdare('on', '*', (e) => events.push(e.type));</script>
<script src="/api/chat/widget.js?bot=support" ${attrs} async></script></body></html>`;

// Says ready, and sends one finished answer each time the panel is hidden: as if the answer the
// visitor waited for arrived after they closed the chat.
const chat = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Chat</title><body><p>Fake chat</p><script>
addEventListener('message', (event) => {
  if (event.data?.type !== 'askdare:init') return;
  const port = event.ports[0];
  port.onmessage = (m) => {
    if (m.data?.type === 'hidden') setTimeout(() => port.postMessage({ v: 1, type: 'event', event: { type: 'message.received', outcome: 'completed', durationMs: 5, citations: 0 } }), 300);
  };
  port.postMessage({ v: 1, type: 'ready' });
});
</script></body></html>`;

const loader = await readFile(new URL('../out/lean-bubble-badge-attr/loader.js', import.meta.url), 'utf8');
const widget = loader.replace(/(['"`])__ASKDARE_LAUNCHERS__\1/, () =>
  JSON.stringify(JSON.stringify({ support: look })),
);

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (type, body) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  if (url.pathname === '/api/chat/widget.js') send('text/javascript', widget);
  else if (url.pathname === '/api/chat/embed/support') send('text/html', chat);
  else if (url.pathname === '/') send('text/html', host(url.searchParams.has('off') ? 'data-greeting="off"' : ''));
  else {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
