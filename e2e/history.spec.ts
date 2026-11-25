import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

// A long conversation comes back in pages (docs/protocol.md, "History pages"): the chat shows the
// latest, and loads older ones as the visitor scrolls up or presses "Show earlier messages". The
// mock stores 60 earlier turns before a message with "[long]", so the history has two pages.
const APP = 'http://localhost:3100';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

// No entrance animations: positions and contrast are measured on messages at rest.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** Starts a long conversation and reloads, so the chat shows its latest page. */
async function longConversation(page: Page, url: string, chat: Locator): Promise<void> {
  await page.goto(url);
  const field = chat.getByRole('textbox', { name: 'Type your message…' });
  await field.fill('Start [long]');
  await field.press('Enter');
  const answer = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(answer).toHaveAttribute('data-status', 'done');
  await page.reload();
  await expect(chat.getByText('You said: Start [long]', { exact: false })).toBeVisible();
}

/** How far below the top of the conversation's scroll box a message is. */
const offset = (log: Locator, text: string): Promise<number> =>
  log.evaluate((element, wanted) => {
    const message = [...element.querySelectorAll('[data-ask-part="message"]')].find(
      (node) => node.textContent?.trim() === wanted,
    );
    if (!message) throw new Error(`No message "${wanted}"`);
    return message.getBoundingClientRect().top - element.getBoundingClientRect().top;
  }, text);

for (const [where, url, scope] of [
  ['in the iframe widget', `${APP}/api/chat/embed/support`, 'body'],
  ['inside a page', `${APP}/inline`, '[data-askdare-root]'],
] as const) {
  test(`loads earlier messages on scrolling up, in place ${where}`, async ({ page }) => {
    const chat = page.locator(scope);
    await longConversation(page, url, chat);
    const log = chat.getByRole('log');
    const messages = log.locator('[data-ask-part="message"]');
    const more = chat.getByRole('button', { name: 'Show earlier messages' });
    // The latest page starts with a whole turn; older turns wait above it.
    await expect(more).toHaveCount(1);
    await expect(messages.first()).toHaveText('Earlier question 12');
    await expect(chat.getByText('Earlier question 11', { exact: true })).toHaveCount(0);
    expect(await new AxeBuilder({ page }).withTags(TAGS).include(scope).analyze()).toMatchObject({
      violations: [],
    });

    // Scrolled to the top: the older page loads above, and what the visitor read stays put.
    const before = await log.evaluate((element) => {
      element.scrollTop = 0;
      return element.scrollTop;
    });
    expect(before).toBe(0);
    const top = await offset(log, 'Earlier question 12');
    await expect(messages.first()).toHaveText('Earlier question 1');
    expect(Math.abs((await offset(log, 'Earlier question 12')) - top)).toBeLessThanOrEqual(1);
    expect(await log.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    // The start of the conversation: nothing more to load.
    await expect(more).toHaveCount(0);
    await expect(messages).toHaveCount(122);
    await expect(chat.locator('[data-ask-part="announcement"]')).toHaveText(
      'Earlier messages loaded.',
    );
  });

  test(`loads earlier messages from the keyboard ${where}`, async ({ page }) => {
    const chat = page.locator(scope);
    await longConversation(page, url, chat);
    const more = chat.getByRole('button', { name: 'Show earlier messages' });
    await more.focus();
    await page.keyboard.press('Enter');
    const messages = chat.locator('[data-ask-part="message"]');
    await expect(messages.first()).toHaveText('Earlier question 1');
    // The button is gone with the last page: focus goes to the oldest message, in view.
    await expect(more).toHaveCount(0);
    await expect(messages.first()).toBeFocused();
    await expect(messages.first()).toBeInViewport();
    await expect(chat.locator('[data-ask-part="announcement"]')).toHaveText(
      'Earlier messages loaded.',
    );
  });
}
