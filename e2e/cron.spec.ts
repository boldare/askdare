import { expect, test } from '@playwright/test';
import { CRON_SECRET } from './support/admin';

// The daily sweep (site/app/api/cron/sweep, docs/admin.md step 5) behind Vercel Cron's
// CRON_SECRET, on the memory admin store the e2e site runs with.
const SWEEP = 'http://localhost:3100/api/cron/sweep';

test('the sweep route refuses a missing or wrong bearer token', async ({ request }) => {
  const refused = [
    {},
    { authorization: 'Bearer not-the-cron-secret-but-just-as-long-12' },
    { authorization: 'Bearer ' },
    // The secret alone, or under another scheme, is not a bearer token.
    { authorization: CRON_SECRET },
    { authorization: `Basic ${CRON_SECRET}` },
    { authorization: `Bearer ${CRON_SECRET}x` },
  ];
  for (const headers of refused) {
    const response = await request.get(SWEEP, { headers });
    expect(response.status(), JSON.stringify(headers)).toBe(401);
    expect(await response.text()).toBe('');
  }
});

test('the right token runs sweep() and returns its result', async ({ request }) => {
  const response = await request.get(SWEEP, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  // OpenAI's conversation store can't list idle conversations, so only admin records are swept,
  // and none of this run's are older than the 30 days of retention.
  expect(await response.json()).toEqual({ conversations: 0, files: 0, records: 0, more: false });
});
