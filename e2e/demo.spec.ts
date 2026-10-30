import { expect, test } from '@playwright/test';

const APP = 'http://localhost:3100';

// The starter's home page: the hero shape is a button that opens the chat.
for (const [theme, look] of [
  ['aura', 'liquid'],
  ['bldr', 'network'],
] as const) {
  test(`the ${theme} shape, as ${look}, opens the chat`, async ({ page }) => {
    await page.goto(`${APP}/?theme=${theme}&mode=bubble&look=${look}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('AI assistant');
    await page.getByRole('button', { name: 'Open the chat' }).click();
    const chat = page.frameLocator('iframe[title="Chat"]');
    await expect(chat.getByRole('textbox')).toBeVisible({ timeout: 10_000 });
  });
}

test('the look switch keeps the page and the choice', async ({ page }) => {
  await page.goto(`${APP}/?theme=halo&mode=bubble`);
  const looks = page.getByRole('group', { name: 'Shape style' });
  await expect(looks.getByRole('button', { name: 'Liquid' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await looks.getByRole('button', { name: 'Network' }).click();
  await expect(looks.getByRole('button', { name: 'Network' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).toHaveURL(/look=network/);
  // The theme links reload the page: they carry the choice along.
  await page.getByRole('link', { name: 'Sage', exact: true }).click();
  await expect(page).toHaveURL(/theme=sage.*look=network/);
  await expect(
    page.getByRole('group', { name: 'Shape style' }).getByRole('button', { name: 'Network' }),
  ).toHaveAttribute('aria-pressed', 'true');
});
