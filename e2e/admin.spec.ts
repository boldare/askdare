import { createHmac } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { ADMIN_SECRET, ADMIN_USER, IDENTITY_SECRET } from './support/admin';

// The owners' console at /api/chat/admin (ADR-0032) with the memory admin store and the
// @boldare/askdare-admin dashboard: who gets in and who doesn't. Sign-ins are limited to 5 a
// minute per address, so this file signs in four times in all.
const APP = 'http://localhost:3100';
const CONSOLE = `${APP}/api/chat/admin`;

/** An identity token as the app's own admin page would sign it (ADR-0009, audience `askdare:admin`). */
function adminToken(user: string, audience = 'askdare:admin'): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: user, aud: audience, iat: now, exp: now + 300 };
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${unsigned}.${createHmac('sha256', IDENTITY_SECRET).update(unsigned).digest('base64url')}`;
}

async function signInWithSecret(page: Page, secret: string): Promise<void> {
  await page.getByLabel('ADMIN_SECRET').fill(secret);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const consoleHeader = (page: Page): Locator => page.locator('.ac-header');

test('the console page and its API refuse what has no session', async ({ page, request }) => {
  const response = await page.goto(CONSOLE);
  const headers = response?.headers() ?? {};
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-robots-tag']).toBe('noindex');
  await expect(page.getByRole('heading', { name: 'askdare console' })).toBeVisible();

  // Every API request needs the admin token: there is no GET that returns data.
  const config = await request.post(`${CONSOLE}/api/config`, {
    headers: { origin: APP, 'content-type': 'application/json' },
    data: {},
  });
  expect(config.status()).toBe(401);
  const dashboard = await request.post(`${CONSOLE}/api/dashboard/days`, {
    headers: { origin: APP, 'content-type': 'application/json' },
    data: {},
  });
  expect(dashboard.status()).toBe(401);
});

test('a wrong ADMIN_SECRET is refused; the right one opens the console and its dashboard', async ({
  page,
}) => {
  // Something for the dashboard to count: a turn and a handoff (on the bot handoff.spec.ts leaves
  // room on, under the form submission limit).
  await page.goto(`${APP}/api/chat/embed/sage`);
  await page.getByRole('textbox', { name: 'Type your message…' }).fill('Is there a free plan?');
  await page.getByRole('textbox', { name: 'Type your message…' }).press('Enter');
  await expect(
    page.locator('[data-ask-part="message"][data-role="assistant"]').last(),
  ).toHaveAttribute('data-status', 'done');
  await page.getByRole('button', { name: 'Talk to a person' }).click();
  const form = page.getByRole('form', { name: 'Talk to a person' });
  await form.getByLabel('Name').fill('Eve');
  await form.getByLabel('Email').fill('eve.admin-test@example.com');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-ask-part="form-done"]')).toContainText('Done.');

  await page.goto(CONSOLE);
  await signInWithSecret(page, 'not-the-admin-secret-but-just-as-long-1234');
  await expect(page.locator('.ac-error')).toBeVisible();
  await expect(consoleHeader(page)).toHaveCount(0);
  // The field is emptied, so the secret doesn't stay on the page.
  await expect(page.getByLabel('ADMIN_SECRET')).toHaveValue('');

  await signInWithSecret(page, ADMIN_SECRET);
  await expect(consoleHeader(page)).toBeVisible();
  // The resolved configuration of each bot, the handoff and forms included.
  await expect(page.getByRole('heading', { name: 'support', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const dashboard = page.locator('.askdare-dashboard');
  await expect(dashboard.getByRole('navigation', { name: 'Dashboard views' })).toBeVisible();
  const tile = (label: string) =>
    dashboard.locator('.ad-tile').filter({ has: page.getByText(label, { exact: true }) });
  await expect(tile('Handoffs').locator('strong')).not.toHaveText('0');
  await expect(tile('Turns').locator('strong')).not.toHaveText('0');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('ADMIN_SECRET')).toBeVisible();
});

test('an identity token signs in a listed user only', async ({ page }) => {
  // Someone the app signed in, but not in `admin.console.allow`.
  await page.goto(`${CONSOLE}#identity=${adminToken('someone-else')}`);
  await expect(page.locator('.ac-error')).toBeVisible();
  await expect(consoleHeader(page)).toHaveCount(0);
  // The token leaves the address bar at once.
  expect(new URL(page.url()).hash).toBe('');

  // A new page load: a change of the fragment alone isn't one.
  await page.goto('about:blank');
  await page.goto(`${CONSOLE}#identity=${adminToken(ADMIN_USER)}`);
  await expect(consoleHeader(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});
