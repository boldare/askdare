import { expect, type Page, test } from '@playwright/test';

const ALLOWED_HOST = 'http://127.0.0.1:4000/';
const FOREIGN_HOST = 'http://127.0.0.1:4001/';

async function openChat(page: Page) {
  await page.locator('[part="launcher"]').click();
  return page.frameLocator('iframe[title="Chat"]');
}

test('chats from an allowed third-party site', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  await expect(chat.getByText('Ask me anything about this demo.')).toBeVisible();

  await chat.getByRole('textbox').fill('Hello there');
  await chat.getByRole('textbox').press('Enter');

  const reply = chat.locator('[data-cd-part="message"][data-role="assistant"]').last();
  await expect(reply).toContainText('You said: Hello there');
  await expect(reply).toHaveAttribute('data-status', 'done');
});

test('continues the same conversation after a reload', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  let chat = await openChat(page);
  await chat.getByRole('textbox').fill('First');
  await chat.getByRole('textbox').press('Enter');
  const first = chat.locator('[data-cd-part="message"][data-role="assistant"]').last();
  await expect(first).toHaveAttribute('data-status', 'done');
  const conversation = /\(in (conv_\d+)\)/.exec((await first.textContent()) ?? '')?.[1];
  expect(conversation).toBeTruthy();

  await page.reload();
  chat = await openChat(page);
  await chat.getByRole('textbox').fill('Second');
  await chat.getByRole('textbox').press('Enter');
  await expect(
    chat.locator('[data-cd-part="message"][data-role="assistant"]').last(),
  ).toContainText(`You said: Second (in ${conversation})`);
});

test('closes from inside the iframe with Escape and returns focus', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  await chat.getByRole('textbox').press('Escape');
  await expect(page.locator('[part="panel"]')).toBeHidden();
  await expect(page.locator('[part="launcher"]')).toBeFocused();
});

test('refuses to load inside a site that is not on the allowlist', async ({ page }) => {
  const blocked = page.waitForEvent('console', (message) =>
    message.text().includes('frame-ancestors'),
  );
  await page.goto(FOREIGN_HOST);
  const chat = await openChat(page);
  await blocked;
  await expect(chat.getByRole('textbox')).toHaveCount(0);
});
