/** The request and response helpers the chat API and the admin console share. */
import type { z } from 'zod';
import { AskdareError, type AskdareErrorOptions } from '../errors';

export const MAX_BODY_BYTES: number = 256 * 1024;
export const NO_STORE: { readonly 'Cache-Control': 'no-store' } = { 'Cache-Control': 'no-store' };

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
  });
}

export function errorResponse(error: AskdareError, explanation?: string): Response {
  const retry = error.retryAfterMs;
  return jsonResponse(
    {
      error: {
        code: error.code,
        // A development explanation replaces the visitor's message and its translation.
        message: explanation ?? error.message,
        ...(retry ? { retryAfterMs: retry } : {}),
        ...(error.key && !explanation ? { key: error.key } : {}),
        ...(error.params ? { params: error.params } : {}),
      },
    },
    error.status,
    retry ? { 'Retry-After': String(Math.ceil(retry / 1000)) } : {},
  );
}

/**
 * Defense in depth only: browsers can't reach the API cross-origin anyway, because JSON bodies need
 * a CORS preflight we never grant. Compares Origin with the Host header, which proxies set, never
 * with X-Forwarded-Host, which clients control.
 */
export function assertSameOrigin(request: Request): void {
  const denied = (): AskdareError =>
    new AskdareError('unauthorized', { message: 'Cross-origin requests are not allowed.' });
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw denied();
  const origin = request.headers.get('origin');
  if (origin === null) return;
  const host = request.headers.get('host') ?? new URL(request.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw denied();
  }
  if (originHost !== host) throw denied();
}

/** Reads at most `limit` bytes and cancels the upload as soon as it grows past the limit. */
export async function readBytes(
  request: Request,
  limit: number,
  tooLargeError: AskdareErrorOptions = { message: 'Request body is too large.' },
): Promise<Uint8Array> {
  const tooLarge = (): AskdareError => new AskdareError('invalid_input', tooLargeError);
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw tooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new AskdareError('invalid_input', { message: 'Expected an application/json body.' });
  }
  const text = new TextDecoder().decode(await readBytes(request, MAX_BODY_BYTES));
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AskdareError('invalid_input', { message: 'Malformed JSON.' });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AskdareError('invalid_input');
  return parsed.data;
}

export function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) throw new AskdareError('unauthorized');
  return match[1];
}
