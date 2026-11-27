import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// The greeting next to the closed launcher and the unread badge, drawn by the loader (ADR-0033).
// The site's `support` bot greets after 4 seconds; the page's clock skips the wait.
const HOST = 'http://127.0.0.1:4100/';
const DELAY = 4_000;
const GREETING = 'Hi! I’m an AI assistant. Can I help you?';

/** Loads a page with a fake clock, and waits for the launcher (the delay starts when it mounts). */
async function visit(page: Page, url = HOST): Promise<void> {
  await page.clock.install();
  await page.goto(url);
  await expect(page.locator('[part="launcher"]')).toBeVisible();
}

const greeting = (page: Page) => page.locator('[part="greeting"]');
const stored = (page: Page) => page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
const events = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { events: { type: string }[] }).events.map((event) => event.type),
  );

test('shows after its delay without moving focus or storing anything', async ({ page }) => {
  await visit(page, `${HOST}?variant=events`);
  await page.clock.runFor(DELAY - 500);
  await expect(greeting(page)).toHaveCount(0);
  await page.clock.runFor(500);
  await expect(greeting(page)).toBeVisible();
  await expect(greeting(page).getByRole('button', { name: GREETING })).toBeVisible();
  await expect(page.locator('body')).toBeFocused();
  expect(await stored(page)).toBe('[]');
  expect(await events(page)).toEqual(['greeting.shown']);

  // In the tab order just before the launcher; the × is at least 24 × 24 px (WCAG 2.5.8).
  await greeting(page).getByRole('button', { name: GREETING }).focus();
  await page.keyboard.press('Tab');
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  await expect(dismiss).toBeFocused();
  // Measured once its entrance animation (which scales it up) has ended.
  await greeting(page).evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const box = await dismiss.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(24);
  expect(box?.height).toBeGreaterThanOrEqual(24);
  await page.keyboard.press('Tab');
  await expect(page.locator('[part="launcher"]')).toBeFocused();
  expect(await stored(page)).toBe('[]');
});

test('× dismisses it, focuses the launcher, and it stays away for the session', async ({
  page,
}) => {
  await visit(page, `${HOST}?variant=events`);
  await page.clock.runFor(DELAY);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(greeting(page)).toHaveCount(0);
  await expect(page.locator('[part="launcher"]')).toBeFocused();
  expect(await events(page)).toEqual(['greeting.shown', 'greeting.dismissed']);
  expect(await stored(page)).toBe('[["askdare:support:greeted","1"]]');

  await page.reload();
  await expect(page.locator('[part="launcher"]')).toBeVisible();
  await page.clock.runFor(DELAY * 3);
  await expect(greeting(page)).toHaveCount(0);
});

test('Escape dismisses it', async ({ page }) => {
  await visit(page);
  await page.clock.runFor(DELAY);
  await greeting(page).getByRole('button', { name: GREETING }).focus();
  await page.keyboard.press('Escape');
  await expect(greeting(page)).toHaveCount(0);
  await expect(page.locator('[part="launcher"]')).toBeFocused();
});

test('clicking it opens the chat, and it stays away for the session', async ({ page }) => {
  await visit(page, `${HOST}?variant=events`);
  await page.clock.runFor(DELAY);
  await greeting(page).getByRole('button', { name: GREETING }).click();
  await expect(greeting(page)).toHaveCount(0);
  await expect(page.frameLocator('iframe[title="Chat"]').getByRole('textbox')).toBeVisible();
  expect((await events(page)).filter((type) => type !== 'ready')).toEqual([
    'greeting.shown',
    'open',
  ]);

  await page.reload();
  await expect(page.locator('[part="launcher"]')).toBeVisible();
  await page.clock.runFor(DELAY * 3);
  await expect(greeting(page)).toHaveCount(0);
});

test('not after the chat was opened, and not with data-greeting="off"', async ({ page }) => {
  await visit(page);
  await page.locator('[part="launcher"]').click();
  await page.locator('[part="launcher"]').click();
  await page.clock.runFor(DELAY * 3);
  await expect(greeting(page)).toHaveCount(0);

  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${HOST}?variant=greeting-off`);
  await expect(page.locator('[part="launcher"]')).toBeVisible();
  await page.clock.runFor(DELAY * 3);
  await expect(greeting(page)).toHaveCount(0);
  expect(await stored(page)).toBe('[]');
});

test('the greeting has no axe violations, in both schemes', async ({ page }) => {
  await page.clock.install();
  for (const colorScheme of ['light', 'dark'] as const) {
    // Reduced motion: axe would measure contrast while the greeting still fades in.
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
    await page.goto(HOST);
    await expect(page.locator('[part="launcher"]')).toBeVisible();
    await page.clock.runFor(DELAY);
    await expect(greeting(page)).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .include('[data-askdare]')
      .analyze();
    expect(
      violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
      colorScheme,
    ).toEqual([]);
  }
});

test('shows on a page that enforces Trusted Types', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') violations.push(message.text());
  });
  await visit(page, `${HOST}?variant=trusted-types`);
  await page.clock.runFor(DELAY);
  await expect(greeting(page).getByRole('button', { name: GREETING })).toBeVisible();
  expect(violations).toEqual([]);
});

test('the badge counts answers that arrive while the chat is closed', async ({ page }) => {
  await page.goto(HOST);
  const launcher = page.locator('[part="launcher"]');
  await launcher.click();
  const chat = page.frameLocator('iframe[title="Chat"]');
  // "[slow]" makes the answer take about a second, so it arrives after the chat is closed.
  await chat.getByRole('textbox').fill('[slow] Are you there?');
  await chat.getByRole('textbox').press('Enter');
  await launcher.click();
  await expect(launcher).toHaveAttribute('data-unread', '1');
  await expect(launcher).toHaveAccessibleName('Ask Brightloop AI, Open chat, new messages');

  await launcher.click();
  await expect(launcher).not.toHaveAttribute('data-unread');
  await expect(launcher).toHaveAccessibleName('Close chat');
  await launcher.click();
  await expect(launcher).toHaveAccessibleName('Ask Brightloop AI, Open chat');
});

// WCAG 2.4.11: tabbing through the site's demo with the greeting open, nothing that has focus is
// hidden behind it (or the launcher).
test('the greeting hides nothing that has focus on the site demo', async ({ page }) => {
  await page.clock.install();
  await page.goto('http://localhost:3100/');
  await expect(page.locator('[part="launcher"]')).toBeVisible();
  await page.clock.runFor(DELAY);
  await expect(greeting(page)).toBeVisible();

  const hidden: string[] = [];
  const seen = new Set<string>();
  for (let step = 0; step < 300; step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      // The greeting and the launcher themselves, inside the loader's shadow root.
      if (!element || element === document.body || element.hasAttribute('data-askdare')) {
        return { key: element?.tagName ?? '', hidden: false };
      }
      const box = element.getBoundingClientRect();
      const points = [
        [box.x + box.width / 2, box.y + box.height / 2],
        [box.x + 2, box.y + 2],
        [box.right - 2, box.y + 2],
        [box.x + 2, box.bottom - 2],
        [box.right - 2, box.bottom - 2],
      ];
      // Hidden only when every point of it lands on the loader's elements.
      const covered = points.every(([x, y]) =>
        document.elementFromPoint(x as number, y as number)?.closest('[data-askdare]'),
      );
      const key = `${element.tagName} ${element.getAttribute('href') ?? ''} ${
        element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? ''
      }`;
      return { key, hidden: covered };
    });
    if (focused.hidden) hidden.push(focused.key);
    // Back where it started: every stop has been visited.
    if (seen.has(focused.key) && step > 5) break;
    seen.add(focused.key);
  }
  expect(seen.size).toBeGreaterThan(5);
  expect(hidden).toEqual([]);
  await expect(greeting(page)).toBeVisible();
});
