import { expect, test } from '@playwright/test';

const APP = 'http://localhost:3100';

// The starter's home page: the hero shape is a button that opens the chat.
for (const theme of ['aura', 'bldr'] as const) {
  test(`the ${theme} shape opens the chat`, async ({ page }) => {
    await page.goto(`${APP}/?theme=${theme}&mode=bubble`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('AI assistant');
    await page.getByRole('button', { name: 'Open the chat' }).click();
    const chat = page.frameLocator('iframe[title="Chat"]');
    await expect(chat.getByRole('textbox')).toBeVisible({ timeout: 10_000 });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the hero shows a still picture, not the 3D scene, and still opens the chat', async ({
    page,
  }) => {
    await page.goto(`${APP}/?theme=sage&mode=bubble`);
    await expect(page.locator('.shape img')).toBeVisible();
    await expect(page.locator('.shape canvas')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open the chat' }).click();
    const chat = page.frameLocator('iframe[title="Chat"]');
    await expect(chat.getByRole('textbox')).toBeVisible({ timeout: 10_000 });
  });

  test('the menu opens, and closes when a link is followed', async ({ page }) => {
    await page.goto(`${APP}/?theme=aura&mode=bubble`);
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(page.getByRole('link', { name: 'How it works' })).toBeHidden();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('link', { name: 'How it works' }).click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page).toHaveURL(/#how$/);
  });
});
