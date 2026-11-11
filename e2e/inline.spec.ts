import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

// The chat inside a page of the app itself, rendered by @boldare/askdare/react (ADR-0011).
const APP = 'http://localhost:3100';
const ROOT = '[data-askdare-root]';

/** Fails the test on a hydration mismatch or any other error the page reports. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function send(chat: Locator, text: string): Promise<Locator> {
  await chat.getByRole('textbox').fill(text);
  await chat.getByRole('textbox').press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  return reply;
}

test('chats in the page with the default look, and keeps the conversation', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${APP}/inline`);
  const chat = page.getByRole('region', { name: 'Brightloop assistant' });
  // Part of the page's outline: the chat's title is a level below the page's.
  await expect(chat.getByRole('heading', { level: 2, name: 'Brightloop assistant' })).toBeVisible();
  await expect(
    chat.getByRole('heading', {
      level: 3,
      name: 'Ask me about Brightloop plans, support or security',
    }),
  ).toBeVisible();
  // It loaded with the page: it neither took focus nor scrolled to itself.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // The theme reached it: Aura's font and a panel that fills the element the page sized.
  const panel = chat;
  await expect(panel).toHaveCSS('font-family', /Plus Jakarta Sans/);
  expect((await page.locator('.inline-chat').boundingBox())?.height).toBeCloseTo(640, 0);
  expect((await panel.boundingBox())?.height).toBeGreaterThan(630);

  const reply = await send(chat, 'Hello **there**');
  await expect(reply).toContainText('You said: Hello there');
  await expect(reply.locator('strong')).toHaveText('there');
  await expect(chat.getByRole('textbox')).toBeFocused();
  const conversation = /\(in (conv_\d+)\)/.exec((await reply.textContent()) ?? '')?.[1];

  await page.reload();
  await expect(chat.getByText(`(in ${conversation})`)).toBeVisible();
  await expect(chat.locator('[data-ask-part="message"]')).toHaveCount(2);

  // Escape on the page is the page's business; in the chat it answers the chat's question.
  await chat.getByRole('button', { name: 'Start a new conversation' }).click();
  await expect(chat.getByRole('alertdialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.getByRole('button', { name: 'A button of the page' }).focus();
  await page.keyboard.press('Escape');
  await expect(chat.getByRole('alertdialog')).toBeVisible();
  await chat.getByRole('alertdialog').getByRole('button', { name: 'Start new' }).click();
  await expect(chat.locator('[data-ask-part="message"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('lists the chat’s events beside it, without what anyone wrote', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${APP}/inline`);
  const panel = page.getByRole('complementary', { name: 'Chat events' });
  const events = panel.getByRole('list', { name: 'Events, newest first' }).getByRole('listitem');
  await expect(events).toHaveCount(1);
  await expect(events.first()).toHaveAttribute('data-type', 'ready');

  const question = 'Is my secret plan safe?';
  await send(page.locator(ROOT), question);
  await expect(events).toHaveCount(3);
  for (const [index, type] of ['message.received', 'message.sent', 'ready'].entries()) {
    await expect(events.nth(index)).toHaveAttribute('data-type', type);
  }
  const field = (type: string, name: string): Locator =>
    panel
      .locator(`li[data-type="${type}"] div`, { has: page.locator('dt', { hasText: name }) })
      .locator('dd');
  await expect(field('message.sent', 'length')).toHaveText(String(question.length));
  await expect(field('message.sent', 'source')).toHaveText('"typed"');
  await expect(field('message.received', 'outcome')).toHaveText('"completed"');
  // Metadata only: neither the question nor the answer reached the page's listener.
  await expect(panel).not.toContainText('secret');

  await panel.getByRole('button', { name: 'Clear' }).click();
  await expect(events).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('attaches a file dropped into the field’s picker', async ({ page }) => {
  await page.goto(`${APP}/inline`);
  const chat = page.locator(ROOT);
  await chat.locator('input[type="file"]').setInputFiles({
    name: 'offer.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n'),
  });
  await expect(chat.locator('[data-ask-part="attachments"] [data-status="ready"]')).toHaveCount(1);
  const reply = await send(chat, 'What is this?');
  await expect(reply).toContainText('[1 files]');
});

test('the default look has no axe violations inside the page', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${APP}/inline`);
  const chat = page.locator(ROOT);
  await expect(chat.getByRole('textbox')).toBeEnabled();
  const check = async (): Promise<string[]> => {
    // Only the chat: the demo page's own markup is not ours to check.
    const { violations } = await new AxeBuilder({ page }).include(ROOT).analyze();
    return violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
  };
  expect(await check(), 'welcome').toEqual([]);
  await send(chat, 'A list:\n\n- one\n- two\n\n[A link](https://example.com)');
  expect(await check(), 'conversation').toEqual([]);
  await chat.getByRole('button', { name: 'Start a new conversation' }).click();
  await expect(chat.getByRole('alertdialog')).toBeVisible();
  expect(await check(), 'question').toEqual([]);

  // Inside a page the question covers only the chat: it isn't modal, so screen readers keep the
  // page, while Tab stays in the question and Escape in it answers no.
  const question = chat.getByRole('alertdialog', { name: 'Start a new conversation' });
  await expect(question).not.toHaveAttribute('aria-modal');
  await expect(question).toHaveAccessibleDescription(/.+/);
  const cancel = question.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeFocused();
  // Safari moves to buttons with Option+Tab unless the visitor turned on Tab for every item.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(tab);
  await expect(question.getByRole('button', { name: 'Start new' })).toBeFocused();
  await page.keyboard.press(tab);
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect(chat.getByRole('button', { name: 'Start a new conversation' })).toBeFocused();
});

test('works with markup written by the page', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${APP}/inline/headless`);
  const chat = page.locator('.plain-chat');
  await expect(chat.getByText('Ask in your own markup')).toBeVisible();
  // No default look: its stylesheet is not even requested.
  expect(await page.locator('link[href*="/assets/skin."]').count()).toBe(0);
  const reply = await send(chat, 'Hello from my markup');
  await expect(reply).toContainText('You said: Hello from my markup');
  await expect(reply.locator('small')).toHaveText('Assistant');
  await chat.getByRole('button', { name: 'Start over' }).click();
  await expect(chat.locator('[data-ask-part="message"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/**
 * Every element inside the chat with the computed styles a CSS reset usually changes, one line per
 * property. The theme root itself is left out: it is the page's element and inherits from it.
 */
async function styles(page: Page): Promise<string[]> {
  return page.evaluate((root) => {
    const PROPERTIES = [
      'display',
      'margin-top',
      'margin-bottom',
      'margin-left',
      'padding-top',
      'padding-left',
      'border-top-width',
      'border-left-width',
      'border-top-left-radius',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'list-style-type',
      'text-decoration-line',
      'color',
      'background-color',
      'background-image',
      'box-sizing',
      'vertical-align',
      'cursor',
      'opacity',
      'width',
      'height',
    ];
    return Array.from(document.querySelectorAll(`${root} *`))
      .filter((element) => !['LINK', 'STYLE'].includes(element.tagName))
      .flatMap((element, index) => {
        const computed = getComputedStyle(element);
        const part = element.getAttribute('data-ask-part') ?? '';
        const name = `${index} ${element.tagName.toLowerCase()}${part ? `[${part}]` : ''}`;
        return PROPERTIES.map(
          (property) => `${name} ${property}: ${computed.getPropertyValue(property)}`,
        );
      });
  }, ROOT);
}

const MARKDOWN = [
  '# Heading',
  '##### Small heading',
  'A paragraph with **bold**, _italic_, ~~struck~~, `code` and [a link](https://example.com).',
  '- one\n- two\n  - nested',
  '1. first\n2. second',
  '> A quote',
  '---',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
  '```\ncode block\n```',
].join('\n\n');

async function renderEverything(page: Page, query: string): Promise<string[]> {
  await page.goto(`${APP}/inline${query}`);
  const chat = page.locator(ROOT);
  await send(chat, MARKDOWN);
  await expect(chat.locator('[data-ask-part="bubble"] table')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return styles(page);
}

for (const reset of ['v3', 'v4']) {
  test(`looks the same on a page with a Tailwind ${reset} reset`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const plain = await renderEverything(page, '');
    await page.evaluate(() => localStorage.clear());
    const withReset = await renderEverything(page, `?reset=${reset}`);
    // The reset is really there: it changed the page around the chat.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-weight', '400');
    expect(withReset.filter((line, index) => line !== plain[index])).toEqual([]);
    expect(withReset).toHaveLength(plain.length);
  });
}
