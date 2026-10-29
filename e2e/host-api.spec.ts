import { expect, test } from '@playwright/test';

// The host-page JavaScript API (ADR-0008, level 3) and the visitor's language.
const HOST = 'http://127.0.0.1:4100/';
const MOCK_OPENAI = 'http://127.0.0.1:4110';

test('a page opens the chat from its own button and gets focus back on close', async ({ page }) => {
  await page.goto(`${HOST}?variant=custom`);
  await expect(page.locator('[part="launcher"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Chat with us' }).click();
  const chat = page.frameLocator('iframe[title="Chat"]');
  await expect(chat.getByRole('textbox')).toBeVisible();
  await chat.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.locator('iframe[title="Chat"]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Chat with us' })).toBeFocused();
});

test('the chat can sit inside an element of the page', async ({ page }) => {
  await page.goto(`${HOST}?variant=inline`);
  const chat = page.frameLocator('#chat iframe');
  await expect(chat.getByRole('textbox')).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Close chat' })).toHaveCount(0);
  await chat.getByRole('textbox').fill('Inline hello');
  await chat.getByRole('textbox').press('Enter');
  await expect(
    chat.locator('[data-cd-part="message"][data-role="assistant"]').last(),
  ).toContainText('You said: Inline hello');
});

test('the page sets the greeting, suggestions and its context, and nothing else', async ({
  page,
  request,
}) => {
  await page.goto(`${HOST}?variant=configure`);
  await page.locator('[part="launcher"]').click();
  const chat = page.frameLocator('iframe[title="Chat"]');
  await expect(chat.getByText('Questions about our prices?')).toBeVisible();
  await chat.getByRole('button', { name: 'How much is the Business plan?' }).click();
  await expect(
    chat.locator('[data-cd-part="message"][data-role="assistant"]').last(),
  ).toContainText('You said: How much is the Business plan?');
  // Tests run in parallel, so find this test's request among all the model saw.
  const all = (await (await request.get(`${MOCK_OPENAI}/debug/instructions`)).json()) as string[];
  const ours = all.find((text) => text.includes('<page_context>'));
  expect(ours).toContain('Pricing page listing the Free, Team and Business plans.');
  expect(ours).not.toContain('not-allowed');
});

test('a bot set to auto speaks the language of the page', async ({ page }) => {
  await page.goto(`${HOST}?lang=pl`);
  await page.getByRole('button', { name: 'Otwórz czat' }).click();
  const chat = page.frameLocator('iframe[title="Chat"]');
  await expect(chat.getByRole('textbox')).toHaveAttribute('placeholder', 'Napisz wiadomość…');
  await expect(chat.getByRole('button', { name: 'Wyślij' })).toBeVisible();
  await expect(chat.getByText('Rozmawiasz z asystentem AI. Może popełniać błędy.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zamknij czat' })).toBeVisible();
});
