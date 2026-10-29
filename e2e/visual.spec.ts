import { expect, type Page, test } from '@playwright/test';

// Every preset in both schemes and every state the gallery renders (ADR-0008).
const APP = 'http://localhost:3100/api/chat/embed/support';
const PRESETS = ['halo', 'aura', 'sage', 'care'] as const;
const SCHEMES = ['light', 'dark'] as const;
const STATES = ['welcome', 'conversation', 'streaming', 'attachments', 'error', 'listening'];

async function render(page: Page, query: Record<string, string>): Promise<void> {
  await page.goto(`${APP}?${new URLSearchParams(query)}`);
  await page.locator('[data-cd-part="panel"]').waitFor();
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
