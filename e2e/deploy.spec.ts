import { expect, test } from '@playwright/test';

const APP = 'http://localhost:3100';

// /deploy: the one-click deploy, with a CHAT_SECRET made in the browser.
test('the secret is made in the browser and never sent', async ({ page, request }) => {
  const sent: string[] = [];
  page.on('request', (sentRequest) => {
    sent.push(`${sentRequest.url()} ${sentRequest.postData() ?? ''}`);
  });
  await page.goto(`${APP}/deploy`);

  const value = page.getByLabel('Your CHAT_SECRET');
  await expect(value).toHaveText(/^[\w-]{43}$/);
  const secret = (await value.textContent()) ?? '';

  await page.getByRole('button', { name: 'Make a new one' }).click();
  await expect(value).not.toHaveText(secret);
  const next = (await value.textContent()) ?? '';

  // The server's HTML has no secret in it, and no request carries either one.
  const html = await (await request.get(`${APP}/deploy`)).text();
  expect(html).not.toContain(secret);
  expect(sent.some((line) => line.includes(secret) || line.includes(next))).toBe(false);
});

test('the deploy button opens Vercel with the starter', async ({ page }) => {
  await page.goto(`${APP}/deploy`);
  const href = await page.getByRole('link', { name: 'Deploy to Vercel' }).getAttribute('href');
  const url = new URL(href ?? '');
  expect(url.origin + url.pathname).toBe('https://vercel.com/new/clone');
  expect(url.searchParams.get('repository-url')).toBe(
    'https://github.com/boldare/askdare/tree/main/examples/starter',
  );
  expect(url.searchParams.get('env')?.split(',')).toEqual(
    expect.arrayContaining(['OPENAI_API_KEY', 'CHAT_SECRET', 'ASKDARE_MODEL']),
  );
});
