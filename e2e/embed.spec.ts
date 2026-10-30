import { expect, type Page, test } from '@playwright/test';

const ALLOWED_HOST = 'http://127.0.0.1:4100/';
const FOREIGN_HOST = 'http://127.0.0.1:4101/';
const MOCK_OPENAI = 'http://127.0.0.1:4110';
// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n');

async function openChat(page: Page) {
  await page.locator('[part="launcher"]').click();
  return page.frameLocator('iframe[title="Chat"]');
}

test('chats from an allowed third-party site', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  await expect(
    chat.getByRole('heading', { name: 'Ask me about Brightloop plans, support or security' }),
  ).toBeVisible();

  await chat.getByRole('textbox').fill('Hello there');
  await chat.getByRole('textbox').press('Enter');

  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toContainText('You said: Hello there');
  await expect(reply).toHaveAttribute('data-status', 'done');
});

test('restores the conversation after a reload and continues it', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  let chat = await openChat(page);
  await chat.getByRole('textbox').fill('First');
  await chat.getByRole('textbox').press('Enter');
  const first = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(first).toHaveAttribute('data-status', 'done');
  const conversation = /\(in (conv_\d+)\)/.exec((await first.textContent()) ?? '')?.[1];
  expect(conversation).toBeTruthy();

  await page.reload();
  chat = await openChat(page);
  // History comes back from the Conversations API.
  await expect(chat.locator('[data-ask-part="message"][data-role="user"]').first()).toHaveText(
    'First',
  );
  await expect(chat.getByText(`You said: First (in ${conversation})`)).toBeVisible();

  await chat.getByRole('textbox').fill('Second');
  await chat.getByRole('textbox').press('Enter');
  await expect(
    chat.locator('[data-ask-part="message"][data-role="assistant"]').last(),
  ).toContainText(`You said: Second (in ${conversation})`);
});

test('starts a new conversation and deletes the old one', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  await chat.getByRole('textbox').fill('Remember me');
  await chat.getByRole('textbox').press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  const old = /\(in (conv_\d+)\)/.exec((await reply.textContent()) ?? '')?.[1];

  // The chat asks in its own panel, not with a browser dialog. Cancel keeps the conversation.
  const restart = chat.getByRole('button', { name: 'Start a new conversation' });
  await restart.click();
  const question = chat.getByRole('alertdialog');
  await expect(question).toContainText('The current one will be deleted.');
  await expect(question.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(question).toHaveCount(0);
  await expect(restart).toBeFocused();
  await expect(chat.locator('[data-ask-part="message"]')).toHaveCount(2);
  // Escape answers no too, and leaves the chat open.
  await restart.click();
  await page.keyboard.press('Escape');
  await expect(chat.getByRole('alertdialog')).toHaveCount(0);
  await expect(chat.getByRole('textbox')).toBeVisible();

  await restart.click();
  await chat.getByRole('alertdialog').getByRole('button', { name: 'Start new' }).click();
  await expect(chat.locator('[data-ask-part="message"]')).toHaveCount(0);

  await chat.getByRole('textbox').fill('Fresh start');
  await chat.getByRole('textbox').press('Enter');
  const fresh = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(fresh).toHaveAttribute('data-status', 'done');
  expect(await fresh.textContent()).not.toContain(`(in ${old})`);
});

test('sends an image and a PDF, and deletes them with the conversation', async ({
  page,
  request,
}) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  const filesBefore = (await (await request.get(`${MOCK_OPENAI}/debug/files`)).json()) as string[];

  await chat.locator('input[type="file"]').setInputFiles([
    { name: 'IMG_0042.png', mimeType: 'image/png', buffer: PNG },
    { name: 'offer.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
  ]);
  const pending = chat.locator('[data-ask-part="attachments"]');
  // Images are re-encoded as JPEG in the browser; SVG never leaves it.
  await expect(pending.locator('[data-status="ready"]')).toHaveCount(2);
  await expect(pending).toContainText('IMG_0042.jpg');
  await expect(pending).toContainText('offer.pdf');
  await expect(pending.locator('[data-status="error"]')).toContainText(
    'This file type is not supported.',
  );

  await chat.getByRole('textbox').fill('What is in these?');
  await chat.getByRole('textbox').press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toContainText('You said: What is in these?');
  await expect(reply).toContainText('[2 files]');
  await expect(chat.locator('[data-ask-part="message-attachments"] li')).toHaveCount(2);
  await expect(pending).toHaveCount(0);

  const uploaded = (await (await request.get(`${MOCK_OPENAI}/debug/files`)).json()) as string[];
  expect(uploaded.length - filesBefore.length).toBe(2);

  await chat.getByRole('button', { name: 'Start a new conversation' }).click();
  await chat.getByRole('alertdialog').getByRole('button', { name: 'Start new' }).click();
  await expect(chat.locator('[data-ask-part="message"]')).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get(`${MOCK_OPENAI}/debug/files`)).json()) as string[])
    .toEqual(filesBefore);
});

test('dictates into the message field without sending', async ({ page }) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  await chat.getByRole('button', { name: 'Dictate a message' }).click();
  // Chromium's fake microphone can take seconds to start in a freshly launched browser.
  await expect(chat.getByRole('status').filter({ hasText: 'Listening…' })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(1_500);
  await chat.getByRole('button', { name: 'Done' }).click();
  await expect(chat.getByRole('textbox')).toHaveValue('Mock transcript');
  await expect(chat.locator('[data-ask-part="message"]')).toHaveCount(0);

  // Escape cancels a dictation instead of closing the chat.
  await chat.getByRole('button', { name: 'Dictate a message' }).click();
  await expect(chat.getByRole('status').filter({ hasText: 'Listening…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chat.getByRole('textbox')).toHaveValue('Mock transcript');
  await expect(chat.getByRole('textbox')).toBeFocused();
  await expect(page.locator('iframe[title="Chat"]')).toBeVisible();

  // Closing the chat stops a dictation: nothing is recorded while the panel is hidden.
  await chat.getByRole('button', { name: 'Dictate a message' }).click();
  await expect(chat.getByRole('status').filter({ hasText: 'Listening…' })).toBeVisible();
  await page.locator('[part="launcher"]').click();
  await page.locator('[part="launcher"]').click();
  await expect(chat.getByRole('status').filter({ hasText: 'Listening…' })).toHaveCount(0);
  await expect(chat.getByRole('textbox')).toHaveValue('Mock transcript');
});

test('finishes a reply after the visitor leaves mid-answer', async ({ page, request }) => {
  await page.goto(ALLOWED_HOST);
  const chat = await openChat(page);
  await chat.getByRole('textbox').fill('[slow] keep going');
  await chat.getByRole('textbox').press('Enter');
  await expect(
    chat.locator('[data-ask-part="message"][data-role="assistant"]').last(),
  ).toContainText('You said');
  await page.goto('about:blank');

  // The server keeps reading the model's stream, so the turn is charged its real usage.
  const outcome = async () => {
    const replies = (await (await request.get(`${MOCK_OPENAI}/debug/replies`)).json()) as {
      text: string;
      outcome: string;
    }[];
    return replies.find((reply) => reply.text.includes('[slow] keep going'))?.outcome;
  };
  await expect.poll(outcome, { timeout: 10_000 }).toBe('completed');
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
  const hint = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('security.allowedOrigins'),
    timeout: 15_000,
  });
  await page.goto(FOREIGN_HOST);
  const chat = await openChat(page);
  await blocked;
  await expect(chat.getByRole('textbox')).toHaveCount(0);
  // Not a blank panel: the visitor is told, and the developer is pointed at the allowlist.
  await expect(page.getByRole('status')).toHaveText(/couldn’t load/, { timeout: 15_000 });
  expect((await hint).text()).toContain('doctor --origin');
});
