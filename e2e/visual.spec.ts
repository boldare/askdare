import { expect, type Page, test } from '@playwright/test';

// Every preset in both schemes and every state the gallery renders (ADR-0008).
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

async function render(page: Page, query: Record<string, string>): Promise<void> {
  await page.goto(`${APP}?${new URLSearchParams(query)}`);
  await page.locator('[data-ask-part="panel"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

for (const preset of PRESETS) {
  for (const scheme of SCHEMES) {
    test(`${preset} ${scheme} in the panel`, async ({ page }) => {
      await page.setViewportSize({ width: 400, height: 640 });
      for (const state of STATES) {
        await render(page, { gallery: state, preset, scheme });
        await expect(page).toHaveScreenshot(`${preset}-${scheme}-${state}.png`);
      }
    });
  }

  test(`${preset} on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    for (const scheme of SCHEMES) {
      await render(page, { gallery: 'welcome', preset, scheme });
      await expect(page).toHaveScreenshot(`${preset}-${scheme}-welcome-mobile.png`);
    }
  });
}

// The same look inside a page, without the iframe (ADR-0011): the theme, fonts and skin arrive as
// stylesheets of the page. (That a CSS reset on the page changes nothing in the chat is checked on
// computed styles in inline.spec.ts: a reset's text-size-adjust on <html> alone moves a few
// hundred antialiasing pixels.)
test('the chat inside a page', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto('http://localhost:3100/inline');
  const chat = page.locator('.inline-chat');
  await expect(chat.getByRole('textbox')).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  // On whole pixels, wherever the page's own text put the chat.
  await page.addStyleTag({
    content: '.inline-chat { position: fixed; top: 0; left: 0; width: 832px; }',
  });
  await expect(chat).toHaveScreenshot('inline-welcome.png');
});

// A tool card (ADR-0017) under an answer inside a page: the site's component, spaced by the skin.
test('a tool card inside a page', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto('http://localhost:3100/inline');
  const chat = page.locator('.inline-chat');
  await chat.getByRole('textbox').fill('What time is it? [card]');
  await chat.getByRole('textbox').press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  await expect(reply.locator('[data-ask-part="tool-result"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  // The answer's width follows its text, whose conversation ID and time change on every run.
  await page.addStyleTag({
    content: `.inline-chat { position: fixed; top: 0; left: 0; width: 832px; }
      .inline-chat [data-role="assistant"] [data-ask-part="message-body"] { width: 420px; }`,
  });
  await expect(reply).toHaveScreenshot('inline-tool-card.png', {
    mask: [reply.locator('[data-card-time]'), reply.locator('[data-ask-part="bubble"]')],
  });
});
