// The test webhook the site's handoffs go to (site/demo-hooks.ts), as a support tool would receive
// them: over HTTPS, signed with Standard Webhooks. `webhookHandoff` refuses plain http outside
// development, and `next start` runs in production, so this server makes a throwaway self-signed
// certificate at start; playwright.config.ts passes it to the site as NODE_EXTRA_CA_CERTS.
//
// HTTPS on WEBHOOK_PORT: POST /handoff checks the signature and keeps the report. A report whose
// contact name is "Unreachable" gets a 503, to test a delivery that fails.
// HTTP on WEBHOOK_DEBUG_PORT: GET /health, and GET /debug/handoffs for the reports received.
import { execFileSync } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:https';
import { join } from 'node:path';

const PORT = Number(process.env.WEBHOOK_PORT ?? 4120);
const DEBUG_PORT = Number(process.env.WEBHOOK_DEBUG_PORT ?? 4121);
const SECRET = process.env.WEBHOOK_SECRET ?? '';
const CERT_DIR = process.env.WEBHOOK_CERT_DIR ?? '';
if (!SECRET.startsWith('whsec_') || !CERT_DIR) {
  throw new Error('webhook.mjs needs WEBHOOK_SECRET (whsec_…) and WEBHOOK_CERT_DIR.');
}
const KEY = Buffer.from(SECRET.slice('whsec_'.length), 'base64');
/** How far a signature's timestamp may be from now, as Standard Webhooks verifiers allow. */
const TOLERANCE_S = 5 * 60;

mkdirSync(CERT_DIR, { recursive: true });
const certFile = join(CERT_DIR, 'cert.pem');
const keyFile = join(CERT_DIR, 'key.pem');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-keyout',
    keyFile,
    '-out',
    certFile,
  ],
  { stdio: 'ignore' },
);

/** Reports received with a valid signature, oldest first, and how many requests were refused. */
const handoffs = [];
let refused = 0;
let unreachable = 0;

/** Standard Webhooks: `v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">`, among others. */
function verified(headers, body) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (typeof id !== 'string' || typeof timestamp !== 'string' || typeof signatures !== 'string') {
    return false;
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  const expected = createHmac('sha256', KEY).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(' ').some((signature) => {
    const [version, value] = signature.split(',');
    const given = Buffer.from(value ?? '', 'base64');
    return version === 'v1' && given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const send = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
};

createServer(
  { cert: readFileSync(certFile), key: readFileSync(keyFile) },
  async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/handoff') return send(response, 404);
    let body = '';
    for await (const chunk of request) body += chunk;
    if (!verified(request.headers, body)) {
      refused += 1;
      return send(response, 401);
    }
    const report = JSON.parse(body);
    if (report.contact?.name === 'Unreachable') {
      unreachable += 1;
      return send(response, 503);
    }
    // A retry of a report that timed out but arrived: drop it by its ID, as receivers should.
    if (!handoffs.some((known) => known.id === report.id)) {
      handoffs.push({ ...report, webhookId: request.headers['webhook-id'] });
    }
    send(response, 204);
  },
).listen(PORT, '127.0.0.1');

createHttpServer((request, response) => {
  if (request.url === '/health') return send(response, 200, { ok: true });
  if (request.url === '/debug/handoffs') {
    return send(response, 200, { handoffs, refused, unreachable });
  }
  send(response, 404);
}).listen(DEBUG_PORT, '127.0.0.1', () =>
  console.log(`test webhook on https://127.0.0.1:${PORT}/handoff`),
);
