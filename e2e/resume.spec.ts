import { expect, test } from '@playwright/test';

// Resuming an answer whose stream dropped (ADR-0027), on the production build under `next start`:
// the turn has to outlive its response, as on Heroku or any long-running Node.js server. The
// widget doesn't resume yet (task r3b), so this drives the protocol with fetch.
const API = 'http://localhost:3100/api/chat';

interface Frame {
  readonly id: number;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

const post = (path: string, body: unknown, token?: string, signal?: AbortSignal) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

/** Reads a stream's frames until `until` says stop, then drops the connection. */
async function frames(
  response: Response,
  until: (frame: Frame) => boolean = () => false,
  drop?: AbortController,
): Promise<Frame[]> {
  expect(response.status).toBe(200);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const read: Frame[] = [];
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return read;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
      const fields = new Map(
        block
          .split('\n')
          .filter((line) => !line.startsWith(':'))
          .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]),
      );
      if (!fields.has('event')) continue;
      const frame = {
        id: Number(fields.get('id')),
        type: fields.get('event') as string,
        data: JSON.parse(fields.get('data') as string) as Record<string, unknown>,
      };
      read.push(frame);
      if (until(frame)) {
        drop?.abort();
        await reader.cancel().catch(() => {});
        return read;
      }
    }
  }
}

test('resumes an answer after its stream dropped midway, without repeating an event', async () => {
  const session = await post('/session', { botId: 'support' });
  const { accessToken } = (await session.json()) as { accessToken: string };
  const text = '[slow] resume after a tunnel';

  const drop = new AbortController();
  const sent = await post('/messages', { botId: 'support', text }, accessToken, drop.signal);
  const seen = await frames(sent, (frame) => frame.type === 'text.delta', drop);
  const resumeToken = seen.find((frame) => frame.type === 'conversation.created')?.data[
    'resumeToken'
  ] as string;
  const messageId = seen.find((frame) => frame.type === 'message.start')?.data[
    'messageId'
  ] as string;
  const after = seen.at(-1)?.id ?? 0;

  const resumed = await frames(
    await post('/resume', { botId: 'support', resumeToken, messageId, after }, accessToken),
  );
  const all = [...seen, ...resumed];
  expect(all.map((frame) => frame.id)).toEqual(all.map((_, index) => index + 1));
  expect(resumed.at(-1)?.type).toBe('message.end');
  const answer = all
    .filter((frame) => frame.type === 'text.delta')
    .map((frame) => frame.data['delta'])
    .join('');
  expect(answer).toContain(`You said: ${text}`);

  // Once the client has seen the end, there is nothing more to send.
  const end = resumed.at(-1)?.id ?? 0;
  const done = await post(
    '/resume',
    { botId: 'support', resumeToken, messageId, after: end },
    accessToken,
  );
  expect(await frames(done)).toEqual([]);

  // Another visitor can't reach it.
  const other = (await (await post('/session', { botId: 'support' })).json()) as {
    accessToken: string;
  };
  const stranger = await post(
    '/resume',
    { botId: 'support', resumeToken, messageId, after: 0 },
    other.accessToken,
  );
  expect(stranger.status).toBe(404);
});
