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
    chat.locator('[data-ask-part="message"][data-role="assistant"]').last(),
  ).toContainText('You said: Inline hello');
});

test('an inline chat waits for its element when the script runs first', async ({ page }) => {
  await page.goto(`${HOST}?variant=early`);
  await expect(page.frameLocator('#chat iframe').getByRole('textbox')).toBeVisible();
  await expect(page.locator('[part="launcher"]')).toHaveCount(0);
});

test('calls made while an inline chat waits for its element still apply', async ({ page }) => {
  await page.goto(`${HOST}?variant=early-queued`);
  await expect(
    page.frameLocator('#chat iframe').getByText('Configured while the page loaded.'),
  ).toBeVisible();
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
    chat.locator('[data-ask-part="message"][data-role="assistant"]').last(),
  ).toContainText('You said: How much is the Business plan?');
  // Tests run in parallel, so find this test's request among all the model saw.
  const all = (await (await request.get(`${MOCK_OPENAI}/debug/requests`)).json()) as {
    instructions: string;
    input: string;
  }[];
  const ours = all.find((sent) => sent.input.includes('[askdare:page-context]'));
  // In the visitor's turn, never in the bot's instructions.
  expect(ours?.input).toContain('Pricing page listing the Free, Team and Business plans.');
  expect(ours?.instructions).not.toContain('Pricing page');
  expect(JSON.stringify(ours)).not.toContain('not-allowed');
});

for (const [variant, signedIn] of [
  ['identity', true],
  ['forged', false],
] as const) {
  test(`identify(): ${signedIn ? 'a signed-in visitor reaches the assistant as themselves' : 'a forged identity reaches nothing'}`, async ({
    page,
    request,
  }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.goto(`${HOST}?variant=${variant}`);
    await page.locator('[part="launcher"]').click();
    const chat = page.frameLocator('iframe[title="Chat"]');
    const text = `Who am I? (${variant})`;
    await chat.getByRole('textbox').fill(text);
    await chat.getByRole('textbox').press('Enter');
    await expect(
      chat.locator('[data-ask-part="message"][data-role="assistant"]').last(),
    ).toContainText(`You said: ${text}`);
    const all = (await (await request.get(`${MOCK_OPENAI}/debug/requests`)).json()) as {
      instructions: string;
      input: string;
    }[];
    const ours = all.find((sent) => sent.input.includes(text));
    if (signedIn) {
      expect(ours?.instructions).toContain('signed in as "Ada Lovelace"');
    } else {
      expect(ours?.instructions).not.toContain('Ada');
      expect(warnings.join('\n')).toContain("askdare('identify') was refused (signature)");
    }
  });
}

test('a bot set to auto speaks the language of the page', async ({ page }) => {
  await page.goto(`${HOST}?lang=pl`);
  await page.getByRole('button', { name: 'Otwórz czat' }).click();
  const chat = page.frameLocator('iframe[title="Chat"]');
  await expect(chat.getByRole('textbox')).toHaveAttribute('placeholder', 'Napisz wiadomość…');
  await expect(chat.getByRole('button', { name: 'Wyślij' })).toBeVisible();
  await expect(chat.getByText('Rozmawiasz z asystentem AI. Może popełniać błędy.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zamknij czat' })).toBeVisible();
});

test('calls made before the script loads are queued and run', async ({ page }) => {
  await page.goto(`${HOST}?variant=queued`);
  await page.locator('[part="launcher"]').click();
  await expect(
    page.frameLocator('iframe[title="Chat"]').getByText('Queued before the script loaded.'),
  ).toBeVisible();
});

test('an inline chat neither takes focus nor scrolls the page when it loads', async ({ page }) => {
  await page.goto(`${HOST}?variant=tall`);
  const chat = page.frameLocator('#chat iframe');
  await expect(chat.getByRole('textbox')).toBeAttached();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});

test.describe('in a Polish browser', () => {
  test.use({ locale: 'pl-PL' });

  test('the launcher follows the browser on a page without a language', async ({ page }) => {
    await page.goto(`${HOST}?lang=none`);
    await expect(page.getByRole('button', { name: 'Otwórz czat' })).toBeVisible();
  });
});
