import { expect, type Page, test } from '@playwright/test';

// The site's own page in the widget's iframe (embedPath, ADR-0018): the `own-page` bot's iframe
// is redirected to /askdare/own-page, which renders EmbedRoot with the default look and the
// site's tool cards. Everything the loader does with askdare's own page must still work.
const HOST = 'http://127.0.0.1:4100/';
const FOREIGN_HOST = 'http://127.0.0.1:4101/';
const MOCK_OPENAI = 'http://127.0.0.1:4110';

const own = (query = '') => `${HOST}?bot=own-page${query}`;
const frameOf = (page: Page) => page.frameLocator('iframe[title="Chat"]');

/**
 * Opens the widget and waits for the page to say `ready` over the bridge: it is server-rendered,
 * so it shows before it has hydrated, and what is typed before then isn't in the chat yet.
 */
async function open(page: Page, query = '') {
  await page.goto(own(query));
  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.locator('[part="launcher"]')).toHaveAttribute('data-ready', '');
}

async function ask(page: Page, text: string) {
  const chat = frameOf(page);
  await chat.getByRole('textbox').fill(text);
  await expect(chat.getByRole('button', { name: 'Send' })).toBeEnabled();
  await chat.getByRole('textbox').press('Enter');
  const answer = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(answer).toHaveAttribute('data-status', 'done');
  return answer;
}

test('the widget opens the site’s page, which draws a tool card and closes the panel', async ({
  page,
}) => {
  await open(page);
  const chat = frameOf(page);
  await expect(chat.getByRole('heading', { level: 1, name: 'Brightloop assistant' })).toBeVisible();
  const frame = page.frames().find((candidate) => candidate.url().includes('/askdare/own-page'));
  expect(frame?.url()).toMatch(/^http:\/\/localhost:3100\/askdare\/own-page(\?|$)/);
  // Nothing of the site's own pages runs in the widget: its root layout is its own.
  await expect(chat.locator('nav')).toHaveCount(0);

  const answer = await ask(page, 'What time is it? [card]');
  const card = answer.locator('[data-ask-part="tool-result"][data-ask-tool="get_current_time"]');
  await expect(card.locator('figcaption')).toHaveText('Europe/Warsaw');

  await chat.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.locator('iframe[title="Chat"]')).toBeHidden();
});

test('the page hears the chat’s events and sets its greeting, through the same bridge', async ({
  page,
}) => {
  await open(page, '&variant=configure');
  await expect(frameOf(page).getByText('Questions about our prices?')).toBeVisible();

  await open(page, '&variant=events');
  await ask(page, 'Hello from the events page');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { events: { type: string }[] }).events.map((event) => event.type),
      ),
    )
    .toContain('message.received');
});

test('a signed-in visitor reaches the assistant as themselves', async ({ page, request }) => {
  await open(page, '&variant=identity');
  const text = 'Who am I? (own page)';
  await ask(page, text);
  const all = (await (await request.get(`${MOCK_OPENAI}/debug/requests`)).json()) as {
    instructions: string;
    input: string;
  }[];
  expect(all.find((sent) => sent.input.includes(text))?.instructions).toContain(
    'signed in as "Ada Lovelace"',
  );
});

test('the chat follows the page into another language and keeps the conversation', async ({
  page,
}) => {
  await open(page, '&variant=follow-lang');
  const chat = frameOf(page);
  await ask(page, 'Before the switch');
  await page.evaluate(() => {
    document.documentElement.lang = 'pl';
  });
  await expect(chat.getByRole('textbox')).toHaveAttribute('placeholder', 'Napisz wiadomość…');
  await expect(chat.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(
    chat.locator('[data-ask-part="message"][data-role="assistant"]').first(),
  ).toContainText('You said: Before the switch');
});

test('a site outside the allowlist can’t frame the page', async ({ page, browserName }) => {
  await page.goto(`${FOREIGN_HOST}?bot=own-page`);
  await page.getByRole('button', { name: 'Open chat' }).click();
  // The route redirects, and the page's own frame-ancestors refuses this origin.
  if (browserName !== 'firefox') {
    await expect(frameOf(page).getByRole('textbox')).toHaveCount(0);
  }
  await expect(page.getByRole('status')).toHaveText(/couldn’t load/, { timeout: 15_000 });
});
