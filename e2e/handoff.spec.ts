import { expect, type Locator, type Page, test } from '@playwright/test';
import { type ReceivedHandoff, webhookLog } from './support/webhook';

// Handoff to a person (ADR-0030) on the demo bot: the visitor's "Talk to a person" button and the
// model's `handoff` call both ask for contact details with the bot's handoff form, then post the
// request to the test webhook (e2e/servers/webhook.mjs), signed with Standard Webhooks.
// A form submission is limited to 5 a minute per bot and address, and every test comes from one
// address: the tests here, in forms.spec.ts and admin.spec.ts share the demo's bots so that none
// gets more than 5 in the chromium and mobile projects together.
const APP = 'http://localhost:3100';

async function ask(chat: Locator, text: string): Promise<Locator> {
  await chat.getByRole('textbox', { name: 'Type your message…' }).fill(text);
  await chat.getByRole('textbox', { name: 'Type your message…' }).press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  return reply;
}

/** Fills in and sends the handoff form; the name picks what the test webhook does with it. */
async function sendHandoffForm(form: Locator, name: string, email: string): Promise<void> {
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('How can we help?').fill('I would like to talk about the Business plan.');
  await form.getByRole('button', { name: 'Send' }).click();
}

/** The report the test webhook received for this email address, once it arrived. */
async function received(email: string): Promise<ReceivedHandoff> {
  let report: ReceivedHandoff | undefined;
  await expect
    .poll(async () => {
      report = (await webhookLog()).handoffs.find((item) => item.contact?.['email'] === email);
      return report;
    })
    .toBeDefined();
  return report as ReceivedHandoff;
}

/** A fresh address per test, so tests that share the webhook find their own report. */
const emailFor = (page: Page, who: string): string =>
  `${who}.${test.info().testId.slice(0, 8)}.${page.viewportSize()?.width}@example.com`;

test('the visitor asks for a person: the form, then the request reaches the webhook', async ({
  page,
}) => {
  await page.goto(`${APP}/api/chat/embed/sage`);
  const chat = page.locator('body');
  const talk = chat.getByRole('button', { name: 'Talk to a person' });
  // Only once a conversation exists, so every handoff belongs to one.
  await expect(talk).toHaveCount(0);
  await ask(chat, 'What does the Business plan include?');
  await expect(talk).toBeVisible();

  const requested = page.waitForResponse((response) =>
    response.url().endsWith('/api/chat/handoff'),
  );
  await talk.click();
  expect(await (await requested).json()).toMatchObject({ state: 'requested' });

  const form = chat.getByRole('form', { name: 'Talk to a person' });
  await expect(form).toBeVisible();
  await expect(form).toHaveAttribute('data-purpose', 'handoff');
  // The message is optional; name and email are not.
  await expect(form.getByLabel('How can we help?')).not.toHaveAttribute('aria-required', 'true');
  const email = emailFor(page, 'anna');
  await sendHandoffForm(form, 'Anna', email);

  const status = chat.locator('[data-ask-part="form-done"]');
  await expect(status).toHaveText(`Done. A person from our team will get back to you at ${email}.`);
  await expect(status).toBeFocused();

  const report = await received(email);
  expect(report).toMatchObject({
    bot: 'sage',
    trigger: 'visitor',
    reason: 'visitor_asked',
    available: true,
    contact: { name: 'Anna', email, message: 'I would like to talk about the Business plan.' },
  });
  // Signed with the report's ID, so a receiver drops a retry; nothing of the conversation, by default.
  expect(report.webhookId).toBe(report.id);
  expect(report.summary).toBeUndefined();
  expect(report.transcript).toBeUndefined();
  expect(report.conversationId).toMatch(/^conv_/);
  expect((await webhookLog()).refused).toBe(0);

  // The state survives a reload: history rebuilds it from the conversation's note.
  await page.reload();
  await expect(chat.locator('[data-ask-part="form-done"]')).toHaveText(
    /Done\. A person from our team will get back to you/,
  );

  // One handoff per conversation: asking again is refused, and nothing more is sent.
  const again = page.waitForResponse((response) => response.url().endsWith('/api/chat/handoff'));
  await chat.getByRole('button', { name: 'Talk to a person' }).click();
  expect(await (await again).json()).toMatchObject({ state: 'limited' });
  await expect(
    chat.getByRole('status').filter({
      hasText: 'You’ve already asked for a person. They’ll get back to you.',
    }),
  ).toBeVisible();
  const sent = (await webhookLog()).handoffs.filter((item) => item.contact?.['email'] === email);
  expect(sent).toHaveLength(1);
});

test('the model hands off: the form under its answer, then the request reaches the webhook', async ({
  page,
}) => {
  await page.goto(`${APP}/api/chat/embed/bldr`);
  const chat = page.locator('body');
  const reply = await ask(chat, 'I want to speak to someone [handoff]');
  // The model wrote on after the tool told it the state; the form waits under its answer.
  await expect(reply).toContainText('You said: I want to speak to someone');
  const form = reply.getByRole('form', { name: 'Talk to a person' });
  await expect(form).toBeVisible();

  const email = emailFor(page, 'ben');
  await sendHandoffForm(form, 'Ben', email);
  await expect(reply.locator('[data-ask-part="form-done"]')).toHaveText(
    `Done. A person from our team will get back to you at ${email}.`,
  );
  expect(await received(email)).toMatchObject({
    bot: 'bldr',
    trigger: 'model',
    reason: 'visitor_asked',
    available: true,
  });
});

test('a delivery that fails is saved as a message instead', async ({ page }) => {
  await page.goto(`${APP}/api/chat/embed/care`);
  const chat = page.locator('body');
  await ask(chat, 'Is there a free plan?');
  const before = (await webhookLog()).unreachable;
  await chat.getByRole('button', { name: 'Talk to a person' }).click();
  // The test webhook answers 503 for this name, and again for the one retry.
  await sendHandoffForm(chat.getByRole('form'), 'Unreachable', emailFor(page, 'cleo'));
  await expect(chat.locator('[data-ask-part="form-done"]')).toHaveText(
    'We’ve saved your message. A person will reply by email.',
  );
  expect((await webhookLog()).unreachable).toBe(before + 2);
});
