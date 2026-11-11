import { expect, type Locator, type Page, test } from '@playwright/test';

// Reply options under the latest answer (ADR-0015), in the iframe widget and in the chat inside a
// page. Nothing on the server offers options yet, so the test adds a `replies` event to the real
// server's answer (backed by the mocked OpenAI API), and the options to its history.
const APP = 'http://localhost:3100';
const OPTIONS = ['**Show** prices', 'Talk to a person'];

/** Adds the options to the next answer, before its `message.end`; later answers stay as they are. */
async function offerOnce(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  let offered = false;
  await page.route('**/api/chat/messages', async (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    let body = await response.text();
    if (!offered) {
      offered = true;
      const messageId = /"type":"message\.start","messageId":"([^"]+)"/.exec(body)?.[1];
      const frame = `event: replies\ndata: ${JSON.stringify({ type: 'replies', messageId, items: OPTIONS })}\n\n`;
      body = body.replace('event: message.end', `${frame}event: message.end`);
    }
    await route.fulfill({ response, body });
  });
  return sent;
}

async function ask(chat: Locator, text: string): Promise<Locator> {
  await chat.getByRole('textbox', { name: 'Type your message…' }).fill(text);
  await chat.getByRole('textbox', { name: 'Type your message…' }).press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  return reply;
}

for (const [where, url, scope] of [
  ['in the iframe widget', `${APP}/api/chat/embed/support`, 'body'],
  ['inside a page', `${APP}/inline`, '[data-askdare-root]'],
] as const) {
  test(`offers options under the latest answer and sends a click as text ${where}`, async ({
    page,
  }) => {
    const sent = await offerOnce(page);
    await page.goto(url);
    const chat = page.locator(scope);
    const reply = await ask(chat, 'Is there a free plan?');

    const group = reply.getByRole('group', { name: 'Suggested replies' });
    await expect(group).toBeVisible();
    // Plain text, never Markdown.
    await expect(group.getByRole('button')).toHaveText(OPTIONS);
    await expect(group.locator('strong')).toHaveCount(0);

    await group.getByRole('button', { name: 'Talk to a person' }).click();
    // Gone as soon as the visitor sends, and the next answer offers none.
    await expect(chat.getByRole('group', { name: 'Suggested replies' })).toHaveCount(0);
    const next = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
    await expect(next).toContainText('You said: Talk to a person');
    await expect(next).toHaveAttribute('data-status', 'done');
    await expect(chat.getByRole('group', { name: 'Suggested replies' })).toHaveCount(0);
    await expect(chat.locator('[data-ask-part="message"][data-role="user"]').last()).toHaveText(
      'Talk to a person',
    );

    // The click went out exactly like typed text, in the conversation the first message started.
    expect(sent.map((body) => body['text'])).toEqual(['Is there a free plan?', 'Talk to a person']);
    expect(Object.keys(sent[1] ?? {}).sort()).toEqual(
      [...Object.keys(sent[0] ?? {}), 'resumeToken'].sort(),
    );
  });
}

test('brings the options of the latest answer back after a reload', async ({ page }) => {
  await page.route('**/api/chat/history', async (route) => {
    const response = await route.fetch();
    const history = (await response.json()) as { messages: Record<string, unknown>[] };
    const latest = history.messages.at(-1);
    if (latest?.['role'] === 'assistant') latest['replies'] = ['Show prices'];
    await route.fulfill({ response, json: history });
  });
  await page.goto(`${APP}/inline`);
  const chat = page.locator('[data-askdare-root]');
  await ask(chat, 'Hello');

  await page.reload();
  const latest = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(latest.getByRole('button', { name: 'Show prices' })).toBeVisible();
});
