import { expect, type Page, test } from '@playwright/test';

const ALLOWED_HOST = 'http://127.0.0.1:4100/';
const FOREIGN_HOST = 'http://127.0.0.1:4101/';

async function openChat(page: Page) {
  await page.locator('[part="launcher"]').click();
  return page.frameLocator('iframe[title="Chat"]');
}

test('chats from an allowed third-party site', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  await expect(chat.getByText('Ask me about Brightloop plans, support or security.')).toBeVisible();

  await chat.getByRole('textbox').fill('Hello there');
  await chat.getByRole('textbox').press('Enter');

  const reply = chat.locator('[data-cd-part="message"][data-role="assistant"]').last();
  await expect(reply).toContainText('You said: Hello there');
  await expect(reply).toHaveAttribute('data-status', 'done');
});

test('restores the conversation after a reload and continues it', async ({ page }) => {
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
  // History comes back from the Conversations API.
  await expect(chat.locator('[data-cd-part="message"][data-role="user"]').first()).toHaveText(
    'First',
  );
  await expect(chat.getByText(`You said: First (in ${conversation})`)).toBeVisible();

  await chat.getByRole('textbox').fill('Second');
  await chat.getByRole('textbox').press('Enter');
  await expect(
    chat.locator('[data-cd-part="message"][data-role="assistant"]').last(),
  ).toContainText(`You said: Second (in ${conversation})`);
});

test('starts a new conversation and deletes the old one', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  await chat.getByRole('textbox').fill('Remember me');
  await chat.getByRole('textbox').press('Enter');
  const reply = chat.locator('[data-cd-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  const old = /\(in (conv_\d+)\)/.exec((await reply.textContent()) ?? '')?.[1];

  page.once('dialog', (dialog) => dialog.accept());
  await chat.getByRole('button', { name: 'Start a new conversation' }).click();
  await expect(chat.locator('[data-cd-part="message"]')).toHaveCount(0);

  await chat.getByRole('textbox').fill('Fresh start');
  await chat.getByRole('textbox').press('Enter');
  const fresh = chat.locator('[data-cd-part="message"][data-role="assistant"]').last();
  await expect(fresh).toHaveAttribute('data-status', 'done');
  expect(await fresh.textContent()).not.toContain(`(in ${old})`);
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
