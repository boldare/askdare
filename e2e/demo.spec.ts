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
