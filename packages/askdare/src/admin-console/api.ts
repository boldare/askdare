/**
 * The console's calls to `<basePath>/admin/api/<action>`: JSON POSTs with the admin token as a
 * Bearer token. The token lives in memory only: no cookies, no storage, a reload signs in again.
 */

export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export class ConsoleError extends Error {
  readonly code: string;
  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
  }
}

/** The API's base, from the page's own path (`<basePath>/admin`). */
export const API: string = `${location.pathname.replace(/\/+$/, '')}/api`;

let token: string | undefined;
let onSignedOut: (() => void) | undefined;

export function setToken(value: string | undefined): void {
  token = value;
}

/** Called once a request finds the session over (expired, rotated secret, removed user). */
export function whenSignedOut(listener: () => void): void {
  onSignedOut = listener;
}

const failure = async (response: Response): Promise<ConsoleError> => {
  const body = (await response.json().catch(() => undefined)) as { error?: ApiError } | undefined;
  return new ConsoleError(body?.error ?? { code: 'internal_error', message: response.statusText });
};

/** Sends one request; resolves to the raw response, or throws the API's error. */
export async function send(action: string, body: unknown, keepalive = false): Promise<Response> {
  const response = await fetch(`${API}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    keepalive,
  });
  if (response.ok) return response;
  const error = await failure(response);
  if ((error.code === 'unauthorized' || error.code === 'session_expired') && action !== 'session') {
    token = undefined;
    onSignedOut?.();
  }
  throw error;
}

export async function call<T>(action: string, body?: unknown): Promise<T> {
  const response = await send(action, body);
  return (response.status === 204 ? null : await response.json()) as T;
}

/** Reads a turn's SSE stream, calling `onEvent` with each event's JSON. */
export async function stream(
  action: string,
  body: unknown,
  onEvent: (event: { readonly type: string } & Record<string, unknown>) => void,
): Promise<void> {
  const response = await send(action, body);
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        try {
          onEvent(JSON.parse(data));
        } catch {
          // A malformed frame is skipped, as the chat client does.
        }
      }
      end = buffer.indexOf('\n\n');
    }
  }
}
