import { expect, type Locator, test } from '@playwright/test';

// Reply options under the latest answer (ADR-0015), in the iframe widget and in the chat inside a
// page. The demo bot lets the model suggest them; the mocked OpenAI API calls `suggest_replies`
// when a message contains "[options]" (after the answer) or "[options-first]" (before it).
const APP = 'http://localhost:3100';
// The mock also suggests "See www.example.com", which the server drops: options carry no links.
const OPTIONS = ['**Show** prices', 'Talk to a person'];

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
  test(`offers the model's options under the latest answer and sends a click as text ${where}`, async ({
    page,
  }) => {
    const sent: Record<string, unknown>[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/chat/messages')) {
        sent.push(request.postDataJSON() as Record<string, unknown>);
      }
    });
    await page.goto(url);
    const chat = page.locator(scope);
    const reply = await ask(chat, 'Is there a free plan? [options]');
    await expect(reply).toContainText('You said: Is there a free plan? [options]');

    const group = reply.getByRole('group', { name: 'Suggested replies' });
    await expect(group).toBeVisible();
    // Plain text, never Markdown.
    await expect(group.getByRole('button')).toHaveText(OPTIONS);
    await expect(group.locator('strong')).toHaveCount(0);

    await group.getByRole('button', { name: 'Talk to a person' }).click();
    // Gone as soon as the visitor sends, and the next answer offers none. The server answered the
    // call itself, or the mock would refuse this turn as the live API does.
    await expect(chat.getByRole('group', { name: 'Suggested replies' })).toHaveCount(0);
    const next = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
    await expect(next).toContainText('You said: Talk to a person');
    await expect(next).toHaveAttribute('data-status', 'done');
    await expect(chat.getByRole('group', { name: 'Suggested replies' })).toHaveCount(0);
    await expect(chat.locator('[data-ask-part="message"][data-role="user"]').last()).toHaveText(
      'Talk to a person',
    );

    // The click went out exactly like typed text, in the conversation the first message started.
    expect(sent.map((body) => body['text'])).toEqual([
      'Is there a free plan? [options]',
      'Talk to a person',
    ]);
    expect(Object.keys(sent[1] ?? {}).sort()).toEqual(
      [...Object.keys(sent[0] ?? {}), 'resumeToken'].sort(),
    );
  });
}

test('answers after options suggested before the answer, in one message', async ({ page }) => {
  await page.goto(`${APP}/inline`);
  const chat = page.locator('[data-askdare-root]');
  const reply = await ask(chat, 'Which plan fits? [options-first]');
  await expect(reply).toContainText('You said: Which plan fits? [options-first]');
  await expect(
    reply.getByRole('group', { name: 'Suggested replies' }).getByRole('button'),
  ).toHaveText(OPTIONS);
  await expect(chat.locator('[data-ask-part="message"][data-role="assistant"]')).toHaveCount(1);
});

test('brings the options of the latest answer back after a reload', async ({ page }) => {
  await page.goto(`${APP}/inline`);
  const chat = page.locator('[data-askdare-root]');
  await ask(chat, 'Hello [options]');

  await page.reload();
  const latest = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(latest).toContainText('You said: Hello [options]');
  await expect(
    latest.getByRole('group', { name: 'Suggested replies' }).getByRole('button'),
  ).toHaveText(OPTIONS);
});
