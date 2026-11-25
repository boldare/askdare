import { expect, type Page, test } from '@playwright/test';

// Resuming an answer whose stream dropped (ADR-0027), on the production build under `next start`:
// the turn has to outlive its response, as on Heroku or any long-running Node.js server. The first
// test drives the protocol with fetch; the others drop the chat's own stream mid-answer.
const APP = 'http://localhost:3100';
const API = `${APP}/api/chat`;

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

/**
 * Cuts the chat's first answer stream after its first words, as a dropped connection would: the
 * page's reader fails, and the connection to the server closes while the answer goes on there.
 */
async function dropFirstAnswer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    let dropped = false;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (dropped || !String(input).endsWith('/api/chat/messages') || !response.body) {
        return response;
      }
      dropped = true;
      const reader = response.body.getReader();
      let words = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (words) {
            await reader.cancel();
            controller.error(new TypeError('network error'));
            return;
          }
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          words = new TextDecoder().decode(value).includes('event: text.delta');
          controller.enqueue(value);
        },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    };
  });
}

/** The mock's whole answer to `text`, each word once. */
const said = (text: string): RegExp =>
  new RegExp(`^You said: ${text.replace(/[[\]]/g, '\\$&')} \\(in conv_\\d+\\)$`);

/** The paths of the chat's API requests, in order. */
function requests(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/chat/') && request.method() === 'POST') {
      paths.push(pathname.slice('/api/chat'.length));
    }
  });
  return paths;
}

for (const [where, url, scope] of [
  ['in the iframe widget', `${API}/embed/support`, 'body'],
  ['inside a page', `${APP}/inline`, '[data-askdare-root]'],
] as const) {
  test(`finishes an answer whose stream dropped midway ${where}`, async ({ page }) => {
    await dropFirstAnswer(page);
    const sent = requests(page);
    // Held a moment, so the quiet status can be seen.
    await page.route('**/api/chat/resume', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.continue();
    });
    await page.goto(url);
    const chat = page.locator(scope);
    const field = chat.getByRole('textbox', { name: 'Type your message…' });
    const text = '[slow] through a tunnel and back';
    await field.fill(text);
    await field.press('Enter');

    await expect(chat.locator('[data-ask-part="status"]')).toHaveText('Reconnecting…');
    const answer = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
    await expect(answer).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
    // Every word once: the resumed events continue the text that was shown.
    await expect(answer.locator('[data-ask-part="bubble"]')).toHaveText(said(text));
    await expect(chat.locator('[data-ask-part="error"]')).toHaveCount(0);
    await expect(chat.locator('[data-ask-part="status"]')).toHaveCount(0);
    expect(sent.filter((path) => path === '/resume')).toHaveLength(1);
    expect(sent).not.toContain('/history');
  });
}

test('takes a dropped answer from the history when it can no longer be resumed', async ({
  page,
}) => {
  await dropFirstAnswer(page);
  const sent = requests(page);
  // As when the reconnect reaches another instance with the default in-memory log; late enough
  // for the answer to be done and stored.
  await page.route('**/api/chat/resume', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.fulfill({
      status: 404,
      json: { error: { code: 'not_found', message: 'Not found.' } },
    });
  });
  await page.goto(`${API}/embed/support`);
  const field = page.getByRole('textbox', { name: 'Type your message…' });
  const text = '[slow] then another server';
  await field.fill(text);
  await field.press('Enter');

  const answer = page.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(answer).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  await expect(answer.locator('[data-ask-part="bubble"]')).toHaveText(said(text));
  await expect(page.locator('[data-ask-part="error"]')).toHaveCount(0);
  expect(sent.slice(-2)).toEqual(['/resume', '/history']);
  // The visitor's message stays where it was, once.
  await expect(page.getByText(text, { exact: true })).toHaveCount(1);
});
