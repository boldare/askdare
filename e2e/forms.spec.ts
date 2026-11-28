import { expect, type Locator, type Request, test } from '@playwright/test';

// The demo bot's lead form (ADR-0031): the model shows it with `show_form`, the widget checks it by
// hand first, the server validates it again and answers with field errors, and a sent form becomes
// its "done" text, also after a reload. The values go to the site's onLead, never to the model.
// The server allows 5 submissions a minute per bot and address, and every test comes from one
// address: see handoff.spec.ts for how the tests share the demo's bots.
const APP = 'http://localhost:3100';
const DONE = 'Thanks! Brightloop’s sales team will write to you. (This is a demo: nobody will.)';

async function ask(chat: Locator, text: string): Promise<Locator> {
  await chat.getByRole('textbox', { name: 'Type your message…' }).fill(text);
  await chat.getByRole('textbox', { name: 'Type your message…' }).press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  return reply;
}

for (const [where, url, scope] of [
  ['in the iframe widget', `${APP}/api/chat/embed/halo`, 'body'],
  ['inside a page', `${APP}/inline`, '[data-askdare-root]'],
] as const) {
  test(`the lead form: errors, then sent ${where}`, async ({ page }) => {
    await page.goto(url);
    const chat = page.locator(scope);
    const reply = await ask(chat, 'Can I get an offer for 40 people? [form]');
    const form = reply.getByRole('form', { name: 'Get an offer' });
    await expect(form).toBeVisible();
    await expect(form).toHaveAttribute('data-purpose', 'lead');

    // Nothing filled in: the widget's own checks, before any request.
    let submissions = 0;
    page.on('request', (request: Request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/chat/forms')) submissions++;
    });
    await form.getByRole('button', { name: 'Send' }).click();
    const name = form.getByLabel('Name');
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByText('This field is required.').first()).toBeVisible();
    await expect(form.getByText('Tick this box to continue.')).toBeVisible();
    const email = form.getByLabel('Email');
    await email.fill('anna@');
    await form.getByRole('button', { name: 'Send' }).click();
    await expect(form.getByText('Enter a valid email address.')).toBeVisible();
    expect(submissions).toBe(0);

    // Fields the widget accepts but the server refuses: its answer names the field, never a value.
    await name.fill('Anna');
    await email.fill('anna@example.com');
    await form.getByLabel('Phone').fill('+48 600 100 200');
    await form.getByLabel('Topic').selectOption('demo');
    await form.getByLabel('Brightloop may contact me about my request.').check();
    await page.route('**/api/chat/forms', async (route) => {
      const body = route.request().postDataJSON() as { values: Record<string, unknown> };
      // An option that isn't in the form, as a hand-made request could send.
      await route.continue({
        postData: JSON.stringify({ ...body, values: { ...body.values, topic: 'free-lunch' } }),
      });
    });
    const refused = page.waitForResponse((response) => response.url().endsWith('/api/chat/forms'));
    await form.getByRole('button', { name: 'Send' }).click();
    const answer = await refused;
    expect(answer.status()).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { code: 'invalid_input', fields: { topic: 'error.form.option' } },
    });
    await expect(form.getByText('Choose one of the options.')).toBeVisible();
    await expect(form.getByLabel('Topic')).toBeFocused();

    // As the widget sent it: accepted, and the form becomes its "done" text.
    await page.unroute('**/api/chat/forms');
    const accepted = page.waitForResponse((response) => response.url().endsWith('/api/chat/forms'));
    await form.getByRole('button', { name: 'Send' }).click();
    expect((await accepted).status()).toBe(200);
    const done = reply.locator('[data-ask-part="form-done"]');
    await expect(done).toHaveText(DONE);
    await expect(done).toBeFocused();

    // History shows it sent, not open again.
    await page.reload();
    await expect(chat.locator('[data-ask-part="form-done"]')).toHaveText(DONE);
    await expect(chat.getByRole('form', { name: 'Get an offer' })).toHaveCount(0);
  });
}

test('the conversation keeps that the form was sent and the topic, never the contact details', async ({
  page,
}) => {
  await page.goto(`${APP}/api/chat/embed/care`);
  const chat = page.locator('body');
  const reply = await ask(chat, 'I would like a demo [form]');
  const form = reply.getByRole('form', { name: 'Get an offer' });
  await form.getByLabel('Name').fill('Dora Unique-Name');
  await form.getByLabel('Email').fill('dora.unique@example.com');
  await form.getByLabel('Topic').selectOption('migration');
  await form.getByLabel('Brightloop may contact me about my request.').check();
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(reply.locator('[data-ask-part="form-done"]')).toHaveText(DONE);

  // The conversation holds the note and the `toModel` field (a topic), and nothing else of the form.
  const conversation = /\(in (conv_\d+)\)/.exec((await reply.textContent()) ?? '')?.[1];
  const items = await (
    await fetch(`http://127.0.0.1:4110/v1/conversations/${conversation}/items?order=asc`)
  ).text();
  expect(items).toContain('[askdare:form] contact sent');
  expect(items).toContain('[askdare:form-values]');
  expect(items).toContain('Topic: ');
  expect(items).not.toContain('Dora');
  expect(items).not.toContain('dora.unique@example.com');
});
