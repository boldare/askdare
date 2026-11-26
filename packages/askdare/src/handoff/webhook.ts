import { HandoffDeliveryError } from './delivery-error';
import { type ChatHandoffReport, HANDOFF_DEADLINE_MS } from './report';

export interface WebhookHandoffOptions {
  /** Where to post the report: `https:` only, or `http://localhost` outside production. */
  readonly url: string;
  /**
   * The Standard Webhooks signing secret your receiver verifies with: `whsec_` and a base64 key
   * of at least 24 bytes. Your own secret, never `CHAT_SECRET`.
   */
  readonly secret: string;
  /** How long one attempt may take, in milliseconds; default 4000, at most 9000. */
  readonly timeoutMs?: number | undefined;
  /** Extra headers, such as an API key of the receiver. They can't replace the signature headers. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

const DEFAULT_TIMEOUT_MS = 4000;
const MAX_TIMEOUT_MS = 9000;
const RETRY_DELAY_MS = 500;
/** A retry shorter than this would only add a duplicate. */
const MIN_RETRY_MS = 1000;
const MIN_KEY_BYTES = 24;
const RESERVED_HEADERS = new Set([
  'content-type',
  'webhook-id',
  'webhook-timestamp',
  'webhook-signature',
]);
const RETRY_STATUSES = new Set([408, 429]);
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const encoder = new TextEncoder();

function parseUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('[askdare] webhookHandoff: `url` is not a valid URL.');
  }
  const local = parsed.protocol === 'http:' && LOOPBACK.test(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && process.env['NODE_ENV'] !== 'production')) {
    throw new TypeError(
      '[askdare] webhookHandoff: `url` must use https (plain http only for localhost, outside production).',
    );
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('[askdare] webhookHandoff: put credentials in `headers`, not in `url`.');
  }
  return parsed;
}

function parseSecret(secret: string): Uint8Array<ArrayBuffer> {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : '';
  if (!BASE64.test(encoded)) {
    throw new TypeError(
      '[askdare] webhookHandoff: `secret` must be `whsec_` followed by a base64 key (Standard Webhooks).',
    );
  }
  const key = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  if (key.length < MIN_KEY_BYTES) {
    throw new TypeError(
      `[askdare] webhookHandoff: \`secret\` must hold at least ${MIN_KEY_BYTES} random bytes.`,
    );
  }
  return key;
}

function parseHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  for (const [name, value] of Object.entries(headers)) {
    if (RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(`[askdare] webhookHandoff: \`headers\` can't set ${name}.`);
    }
    if (/[\r\n]/.test(value)) {
      throw new TypeError(`[askdare] webhookHandoff: the header ${name} contains a line break.`);
    }
  }
  return { ...headers };
}

function base64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type Attempt =
  | { readonly ok: true }
  | { readonly ok: false; readonly retry: boolean; readonly error: HandoffDeliveryError };

/**
 * A handoff transport that posts the report as JSON to your endpoint, signed with Standard
 * Webhooks headers (`webhook-id` is the report's `id`). Each attempt has `timeoutMs`; a network
 * error, a timeout, a `408`, `429` or `5xx` gets one retry after 500 ms, within the ten seconds
 * a handoff has. Redirects are not followed. Throws when the report was not delivered.
 */
export function webhookHandoff(
  options: WebhookHandoffOptions,
): (report: ChatHandoffReport) => Promise<void> {
  const url = parseUrl(options.url);
  const keyBytes = parseSecret(options.secret);
  const extraHeaders = parseHeaders(options.headers ?? {});
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(
      `[askdare] webhookHandoff: \`timeoutMs\` must be a whole number from 1 to ${MAX_TIMEOUT_MS}.`,
    );
  }
  const key = crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);

  async function attempt(id: string, body: string, ms: number): Promise<Attempt> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await crypto.subtle.sign(
      'HMAC',
      await key,
      encoder.encode(`${id}.${timestamp}.${body}`),
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          ...extraHeaders,
          'content-type': 'application/json',
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': `v1,${base64(signature)}`,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(ms),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      return {
        ok: false,
        retry: true,
        error: new HandoffDeliveryError(
          timedOut
            ? `The handoff webhook did not answer within ${ms} ms.`
            : 'The handoff webhook could not be reached.',
          { cause },
        ),
      };
    }
    // The receiver's answer may quote the report: never read it.
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { ok: true };
    return {
      ok: false,
      retry: RETRY_STATUSES.has(response.status) || response.status >= 500,
      error: new HandoffDeliveryError(
        response.status >= 300 && response.status < 400
          ? `The handoff webhook answered with a redirect (${response.status}), which is not followed.`
          : `The handoff webhook answered ${response.status}.`,
      ),
    };
  }

  return async (report) => {
    const startedAt = Date.now();
    const body = JSON.stringify(report);
    const first = await attempt(report.id, body, timeoutMs);
    if (first.ok) return;
    const left = HANDOFF_DEADLINE_MS - (Date.now() - startedAt) - RETRY_DELAY_MS;
    if (!first.retry || left < MIN_RETRY_MS) throw first.error;
    await wait(RETRY_DELAY_MS);
    const second = await attempt(report.id, body, Math.min(timeoutMs, left));
    if (!second.ok) throw second.error;
  };
}
