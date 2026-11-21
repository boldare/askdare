import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// axe with the WCAG 2.2 AA rules (target size among them) and best practices, on every preset,
// scheme and gallery state, and on a host page with the launcher. The mobile project runs it on a
// phone too.
const APP = 'http://localhost:3100/api/chat/embed/support';
const PRESETS = ['halo', 'aura', 'sage', 'care'] as const;
const SCHEMES = ['light', 'dark'] as const;
const STATES = [
  'welcome',
  'conversation',
  'streaming',
  'attachments',
  'error',
  'listening',
  'feedback',
  'replies',
  'replies-composer',
];

// The criteria axe can check, up to WCAG 2.2 AA (docs/accessibility.md). Selecting rules by tag also
// runs those axe leaves off by default, such as target-size (2.5.8).
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** axe violations as readable lines, optionally only inside one element. */
async function violations(
  page: ConstructorParameters<typeof AxeBuilder>[0]['page'],
  scope?: string,
): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const { violations: found } = await (scope ? builder.include(scope) : builder).analyze();
  return found.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

// No entrance animations: axe would measure contrast while a message is still fading in.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const preset of PRESETS) {
  for (const scheme of SCHEMES) {
    test(`${preset} ${scheme} has no axe violations`, async ({ page, isMobile }) => {
      // The phone keeps its own viewport.
      if (!isMobile) await page.setViewportSize({ width: 400, height: 640 });
      for (const state of STATES) {
        await page.goto(`${APP}?${new URLSearchParams({ gallery: state, preset, scheme })}`);
        await page.locator('[data-ask-part="panel"]').waitFor();
        expect(await violations(page), `${state}`).toEqual([]);
      }
    });
  }
}

test('the launcher on a host page has no axe violations', async ({ page }) => {
  await page.goto('http://127.0.0.1:4100/');
  await page.locator('[part="launcher"]').waitFor();
  // Only the widget's element: the test page's own markup is not ours to check.
  expect(await violations(page, '[data-askdare]')).toEqual([]);
});

test('the open chat on a host page has no axe violations and announces the answer', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4100/');
  await page.locator('[part="launcher"]').click();
  const chat = page.frameLocator('iframe[title="Chat"]');
  await chat.getByRole('textbox').fill('Hello **there**');
  await chat.getByRole('textbox').press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  // Once, as the rendered text: no Markdown syntax is read out.
  await expect(chat.locator('[data-ask-part="announcement"][role="status"]')).toHaveText(
    /^You said: Hello there \(in conv_\d+\)$/,
  );
  // axe goes into the chat's iframe.
  expect(await violations(page, '[data-askdare]')).toEqual([]);
});

// WCAG 2.4.11 on the page: a full-screen chat (a phone, or a page zoomed to 400%) covers it, so
// focus must not land behind the chat until it is closed.
test('focus stays in a full-screen chat until it closes', async ({ page, browserName }) => {
  // As in embed.spec.ts: Playwright's WebKit reports the page as inactive once the cross-origin
  // iframe had focus, though the element is the page's active element.
  test.fixme(browserName === 'webkit', 'focus after a cross-origin iframe, in WebKit');
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto('http://127.0.0.1:4100/');
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'behind';
    button.textContent = 'On the page';
    document.body.prepend(button);
  });
  await page.locator('[part="launcher"]').click();
  const chat = page.frameLocator('iframe[title="Chat"]');
  await expect(chat.getByRole('textbox')).toBeVisible();
  await page.locator('#behind').focus();
  await expect(page.locator('[data-askdare]')).toBeFocused();

  await chat.getByRole('textbox').press('Escape');
  await expect(page.locator('[part="launcher"]')).toBeFocused();
  await page.locator('#behind').focus();
  await expect(page.locator('#behind')).toBeFocused();
});

test('the chat inside a page has no axe violations', async ({ page }) => {
  await page.goto('http://localhost:3100/inline');
  await expect(page.locator('.inline-chat').getByRole('textbox')).toBeEnabled();
  expect(await violations(page, '.inline-chat')).toEqual([]);
});

// WCAG 2.4.11 inside the chat: nothing of the chat's own (its header, the message field) covers
// what has focus. The message list scrolls to what gets focus, so this holds on a phone too.
test('a focused control is never hidden by the rest of the chat', async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 400, height: 640 });
  for (const state of ['feedback', 'replies', 'attachments']) {
    await page.goto(`${APP}?${new URLSearchParams({ gallery: state })}`);
    await page.locator('[data-ask-part="panel"]').waitFor();
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, a[href], textarea, input')]
        .filter((element) => element.getClientRects().length > 0)
        .flatMap((element) => {
          element.focus();
          const box = element.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return top && (element.contains(top) || top.contains(element))
            ? []
            : [element.getAttribute('aria-label') ?? element.textContent ?? element.tagName];
        }),
    );
    expect(hidden, state).toEqual([]);
  }
});
