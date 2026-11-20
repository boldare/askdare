import { expect, type Locator, test } from '@playwright/test';

// Tool cards (ADR-0017): the site registers a component for its `get_current_time` tool, whose
// `ui` picks the time zone and the time. The mocked OpenAI API calls that tool for a message with
// "[card]", then answers.
const APP = 'http://localhost:3100';

async function ask(chat: Locator, text: string): Promise<Locator> {
  await chat.getByRole('textbox', { name: 'Type your message…' }).fill(text);
  await chat.getByRole('textbox', { name: 'Type your message…' }).press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  return reply;
}

test('shows a tool card under the answer, after a reload too, and sends a click as text', async ({
  page,
}) => {
  const sent: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/chat/messages')) {
      sent.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto(`${APP}/inline`);
  const chat = page.locator('[data-askdare-root]');
  const reply = await ask(chat, 'What time is it? [card]');
  const card = reply.locator('[data-ask-part="tool-result"][data-ask-tool="get_current_time"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('figcaption')).toHaveText('Europe/Warsaw');
  // Only what `ui` picked: the result's other fields never reach the page.
  await expect(card.locator('[data-card-time]')).not.toBeEmpty();

  await page.reload();
  const restored = chat.locator('[data-ask-part="tool-result"]');
  await expect(restored).toHaveCount(1);
  await expect(restored.locator('figcaption')).toHaveText('Europe/Warsaw');

  await restored.getByRole('button', { name: 'Compare with UTC' }).click();
  const next = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(next).toContainText('You said: And in UTC?');
  await expect(chat.locator('[data-ask-part="message"][data-role="user"]').last()).toHaveText(
    'And in UTC?',
  );
  expect(sent.map((body) => body['text'])).toEqual(['What time is it? [card]', 'And in UTC?']);
});

test('the iframe widget answers as before and shows no card, since it has no components', async ({
  page,
}) => {
  await page.goto(`${APP}/api/chat/embed/support`);
  const chat = page.locator('body');
  const reply = await ask(chat, 'What time is it? [card]');
  await expect(reply).toContainText('You said: What time is it? [card]');
  await expect(chat.locator('[data-ask-part="tool-results"]')).toHaveCount(0);
});
