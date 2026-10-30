import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const APP = 'http://localhost:3100';

// The docs pages, rendered from docs/*.md at build time (ADR-0010).
test('renders a guide with its contents, code and links to other guides', async ({ page }) => {
  await page.goto(`${APP}/docs/getting-started`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting started');
  await expect(page.getByRole('complementary', { name: 'On this page' })).toBeVisible();
  await expect(page.locator('.code pre').first()).toContainText('npm install');
  // A link between guides stays on the site; one out of docs/ goes to GitHub.
  await page.getByRole('link', { name: 'going-public checklist' }).first().click();
  await expect(page).toHaveURL(/\/docs\/going-public$/);
});

test('finds a section by its words and opens it', async ({ page }) => {
  await page.goto(`${APP}/docs`);
  await page.getByRole('button', { name: 'Search the docs' }).click();
  await page.getByRole('searchbox', { name: 'Search the docs' }).fill('frame ancestors');
  const first = page.locator('.d-hits a').first();
  await expect(first).toBeVisible();
  // Guides come before decision records.
  await expect(first).not.toHaveAttribute('href', /\/docs\/adr\//);
  await first.click();
  await expect(page).toHaveURL(/\/docs\/[a-z-]+#/);
});

test('a guide has no axe violations', async ({ page }) => {
  await page.goto(`${APP}/docs/configuration`);
  const results = await new AxeBuilder({ page }).include('.docs').analyze();
  expect(results.violations).toEqual([]);
});
