import { expect, type Locator, type Page, type Request, test } from '@playwright/test';

// 👍 and 👎 under answers (ADR-0012), in the iframe widget and in the chat inside a page.
const APP = 'http://localhost:3100';

async function ask(chat: Locator, text: string): Promise<Locator> {
  await chat.getByRole('textbox', { name: 'Type your message…' }).fill(text);
  await chat.getByRole('textbox', { name: 'Type your message…' }).press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  return reply;
}

/** Every rating the page sends, as the body of POST /feedback. */
function ratings(page: Page): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on('request', (request: Request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/chat/feedback')) {
      sent.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  return sent;
}

for (const [where, url, scope] of [
  ['in the iframe widget', `${APP}/api/chat/embed/support`, 'body'],
  ['inside a page', `${APP}/inline`, '[data-askdare-root]'],
] as const) {
  test(`rates an answer, comments on a 👎 and takes the rating back ${where}`, async ({ page }) => {
    const sent = ratings(page);
    await page.goto(url);
    const chat = page.locator(scope);
    const reply = await ask(chat, 'Is there a free plan?');
    const up = reply.getByRole('button', { name: 'Helpful', exact: true });
    const down = reply.getByRole('button', { name: 'Not helpful' });
    await expect(reply.getByRole('group', { name: 'Rate this answer' })).toBeVisible();
    // The visitor's own message can't be rated.
    await expect(chat.getByRole('group', { name: 'Rate this answer' })).toHaveCount(1);

    const accepted = page.waitForResponse((response) => response.url().endsWith('/feedback'));
    await up.click();
    expect((await accepted).status()).toBe(204);
    await expect(up).toHaveAttribute('aria-pressed', 'true');
    await expect(chat.getByLabel('What went wrong?')).toHaveCount(0);

    // 👎 asks what went wrong, with focus in the field; the comment is optional.
    await down.click();
    await expect(down).toHaveAttribute('aria-pressed', 'true');
    await expect(up).toHaveAttribute('aria-pressed', 'false');
    const comment = chat.getByLabel('What went wrong?');
    await expect(comment).toBeFocused();
    await expect(chat.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    await comment.fill('It did not say what the plan costs.');
    await chat.getByRole('button', { name: 'Send feedback' }).click();
    await expect(comment).toHaveCount(0);

    // The rating survives a reload: the history carries the answer's key, the browser the rating.
    await page.reload();
    const again = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
    await expect(again.getByRole('button', { name: 'Not helpful' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // A click on the pressed button takes the rating back, without asking again.
    await again.getByRole('button', { name: 'Not helpful' }).click();
    await expect(again.getByRole('button', { name: 'Not helpful' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(chat.getByLabel('What went wrong?')).toHaveCount(0);

    await expect.poll(() => sent.length).toBe(4);
    expect(sent.map(({ rating, comment: text }) => ({ rating, text }))).toEqual([
      { rating: 'up', text: undefined },
      { rating: 'down', text: undefined },
      { rating: 'down', text: 'It did not say what the plan costs.' },
      { rating: null, text: undefined },
    ]);
    // Only the opaque handle goes back: never a raw conversation or item id.
    expect(JSON.stringify(sent)).not.toMatch(/conv_|msg_/);
  });
}

test('skips the question after a 👎 with Escape or Skip', async ({ page }) => {
  await page.goto(`${APP}/inline`);
  const chat = page.locator('[data-askdare-root]');
  const reply = await ask(chat, 'Hello');
  const down = reply.getByRole('button', { name: 'Not helpful' });
  await down.click();
  await expect(chat.getByLabel('What went wrong?')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(chat.getByLabel('What went wrong?')).toHaveCount(0);
  await expect(down).toHaveAttribute('aria-pressed', 'true');

  await down.click();
  await down.click();
  await chat.getByRole('button', { name: 'Skip' }).click();
  await expect(chat.getByLabel('What went wrong?')).toHaveCount(0);
  await expect(down).toHaveAttribute('aria-pressed', 'true');
});

test('shows no rating buttons for a bot that turned them off', async ({ page }) => {
  await page.goto(`${APP}/api/chat/embed/care`);
  const reply = await ask(page.locator('body'), 'Hello');
  await expect(reply).toContainText('You said: Hello');
  await expect(page.getByRole('group', { name: 'Rate this answer' })).toHaveCount(0);
  await expect(page.locator('[data-ask-part="feedback-button"]')).toHaveCount(0);
});
