# Handoff to a person

A visitor can ask for a person, and the bot can decide on its own that a person should take over. askdare has no inbox: it hands each request to your `onHandoff` function, which sends it where your team works, by email or to a webhook, and the person answers the visitor outside the chat, usually by email ([ADR-0030](adr/0030-handoff.md)). Live chat between an agent and the visitor in the same window isn't part of 0.7.

| | |
| --- | --- |
| Who can ask | The visitor, with "Talk to a person" in the chat's header, and the model, through a built-in `handoff` tool. Each can be turned off. |
| Where requests go | Your `onHandoff`: `webhookHandoff()`, `emailHandoff()` or a function of your own |
| What a request carries | The reason, the bot, the language, the visitor's contact details from a form, and, only if you turn it on, a summary or the conversation's messages |
| What askdare keeps | Nothing of the request. The conversation gets a short note with the outcome and no content |

## Turn it on

A bot turns handoff on in `defineBot`, and the route says where requests go. Both are needed: a bot with `handoff` and a handler without `onHandoff` stops the route from loading, since the visitor would be told a request was sent that nobody receives.

This setup asks for an email address before the request goes out, and posts each request to a webhook of yours:

```ts
// askdare.config.ts
import { defineBot, defineForm } from '@boldare/askdare';

const contact = defineForm({
  name: 'handoff',
  model: false, // only for handoffs: the model can't show it on its own
  title: 'How can we reach you?',
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'message', type: 'textarea', label: 'What do you need help with?' },
  ],
});

export const bots = [
  defineBot({
    id: 'support',
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: ({ locale }) =>
      `You are the assistant on our website. Answer briefly. Reply in the visitor's language; default to ${locale}. When the visitor wants a person, or you can't help, hand the conversation over. After a handoff, say that a person will reply by email, and keep helping if you can.`,
    forms: [contact],
    handoff: { form: 'handoff' },
  }),
];
```

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler, webhookHandoff } from '@boldare/askdare/next';
import { bots } from '@/askdare.config';

export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onHandoff: webhookHandoff({
    url: process.env.HANDOFF_WEBHOOK_URL ?? '',
    secret: process.env.HANDOFF_WEBHOOK_SECRET ?? '',
  }),
});
```

Generate the signing secret once, and give the same value to the receiver:

```bash
node -e "console.log('whsec_' + require('node:crypto').randomBytes(32).toString('base64'))"
```

```bash
# .env.local
HANDOFF_WEBHOOK_URL=https://support.example.com/api/handoff
HANDOFF_WEBHOOK_SECRET=whsec_…
```

`webhookHandoff()` checks its options when the route loads, so an empty or plain-`http` URL or a malformed secret stops it with a message that says which. Then run the app, open the chat, ask a question, and press the headset button in the chat's header, **Talk to a person**. `npx @boldare/askdare doctor` lists "Handoff is on, and onHandoff receives the requests." for the bot.

`handoff: true` turns it on with every default: the model may hand over, the button shows, no form, always available. To send email instead of posting a webhook, see [Email](#email).

## Who asks for a person

**The visitor,** with the headset button in the chat's header, named **Talk to a person**. It appears once the conversation has its first answer, so every request belongs to a conversation. It runs no model call: the request can't be talked out of, and costs no tokens. `button: false` hides it.

**The model,** with the reserved tool `handoff`. It calls it with one of five fixed reasons, and with `content: 'summary'` or `'transcript'` also a short note for the person (at most 500 characters; longer ones are cut):

| `reason` | When |
| --- | --- |
| `visitor_asked` | The visitor asked for a person. The button always sends this one |
| `cannot_help` | The bot can't answer, for example the knowledge base has nothing on it |
| `complaint` | A complaint |
| `sensitive` | A sensitive topic that a person should handle |
| `sales` | A sales question for the team |

The model never decides where the request goes, who gets it or what else it holds. It isn't offered the tool once the conversation has used up its handoffs, or on the last step of a turn. `model: false` turns the tool off and leaves the button. A bot tool can't be named `handoff`.

Say in your instructions when a person should take over, as in the example above. Once a request is made, the conversation gets a note with its outcome, so the model knows a person was asked and doesn't offer it again.

## What the visitor sees

Each request ends in one of these states. The chat shows it as plain text under the answer it belongs to, and screen readers hear it once.

| State | When | Default text |
| --- | --- | --- |
| `requested` | While askdare checks availability and delivers, or while the form waits | "Connecting you with a person…" (`handoff.connecting`) |
| `sent` | `onHandoff` succeeded | "Done. A person from our team will get back to you by email." (`handoff.sent`), or with the visitor's address, "…at {email}." (`handoff.sentTo`) |
| `saved` | The form went to `onLead` instead, because nobody was available or delivery failed | "We’ve saved your message. A person will reply by email." (`handoff.saved`) |
| `unavailable` | Nobody was available and the bot has no form to leave a message in | "Nobody is available right now. Please try again later." (`handoff.unavailable`) |
| `failed` | Delivery failed and nothing saved the request | "We couldn’t reach the team right now. Please try again later." (`handoff.failed`) |
| `limited` | A [limit](#limits) refused it | "You’ve already asked for a person. They’ll get back to you." (`handoff.limited`) |

When the model handed over, it hears the outcome and writes its answer around it. After a reload, the history shows the outcome again.

The bot keeps answering after a handoff: in a one-way handoff the person answers outside the chat, and the visitor shouldn't be left with nothing until then.

## Options

`handoff` in `defineBot` is `true` or an object. Its type is `HandoffConfig`, from `@boldare/askdare`.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `model` | `boolean` | `true` | The model may call the `handoff` tool. |
| `button` | `boolean` | `true` | The chat shows **Talk to a person**. `model` and `button` can't both be `false`. |
| `form` | `string` | none | The name of a form in the bot's `forms` that collects contact details. See [Contact details](#contact-details). |
| `available` | `(context) => boolean \| Promise<boolean>` | always available | Whether someone can take a request now. See [Office hours](#office-hours). |
| `content` | `'none' \| 'summary' \| 'transcript'` | `'none'` | What of the conversation a request carries. See [What `onHandoff` receives](#what-onhandoff-receives). |
| `limits` | `HandoffLimits` | see [Limits](#limits) | How many requests are accepted. |

## Contact details

With a `form`, the chat shows that form under the answer, and the request goes out once the visitor sends it. It is an ordinary [form](forms.md), usually with `model: false` so the model can't show it for anything else. The person replies to its `email` field: `emailHandoff()` uses it as the reply address, and the chat's "sent" text names it.

- **A signed-in visitor whose identity has an email** ([Signed-in visitors](identity.md)) skips the form while someone is available: that email is the reply address.
- **While nobody is available,** the same form is shown as a message to leave, titled "Nobody is available right now. Leave a message and we'll reply by email." (`handoff.unavailableTitle`). Its values go to your [`onLead`](forms.md#what-onlead-receives) with `source.kind: 'handoff'`, and the visitor sees `saved`. Without `onLead`, they go to `onHandoff` with `available: false`, so they still reach a person, later.
- **When delivery fails after the form was sent,** the values go to `onLead` the same way (`why: 'failed'`), and the visitor sees `saved`. Only when that fails too, or there is no `onLead`, does the visitor see `failed`.

Without a form, the request carries no way to reach an anonymous visitor. That suits a team that reads the conversation and answers a signed-in user in your own product; most sites want the form.

## Office hours

`available` is your office hours, holiday or on-call check. It gets `{ bot, locale, identity }`, may be async and has two seconds. A throw or a timeout counts as unavailable.

```ts
const isOfficeHours = (): boolean => {
  const now = new Date();
  // Monday to Friday, 9:00 to 17:00 in Warsaw.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return !['Sat', 'Sun'].includes(weekday) && hour >= 9 && hour < 17;
};

defineBot({
  // …
  handoff: { form: 'handoff', available: isOfficeHours },
});
```

While nobody is available, a bot with a form takes a message (see above), and one without says so (`unavailable`). The model's tool stays offered: it hears `unavailable` and tells the visitor.

## Where requests go

`onHandoff` is any function that takes the report and resolves when the request was delivered. It is **awaited**, unlike the other hooks, because its outcome is what the visitor sees, and it has ten seconds. A throw or the deadline means the request failed: the visitor is told (or the message saved), and `onError` receives `internal_error` with the name of the error's class only, never its message, since a receiver's error can quote what it was sent.

askdare ships two transports in `@boldare/askdare/next`. Neither adds a dependency.

### Webhook

`webhookHandoff({ url, secret, timeoutMs?, headers? })` posts the report as JSON, signed with [Standard Webhooks](https://www.standardwebhooks.com/) headers, so the receiver can use an existing verifier.

| Option | Default | Notes |
| --- | --- | --- |
| `url` | required | `https:` only; plain `http:` only for `localhost` outside production. No credentials in the URL. Redirects are not followed. |
| `secret` | required | `whsec_` followed by a base64 key of at least 24 bytes. Your own secret, never `CHAT_SECRET`: the receiver holds it too. |
| `timeoutMs` | `4000` | Per attempt, at most 9,000. |
| `headers` | none | Extra headers, such as the receiver's API key. They can't replace the signature headers. |

- **Headers:** `webhook-id` (the report's `id`), `webhook-timestamp` (seconds) and `webhook-signature` (`v1,` and a base64 HMAC-SHA256 of `<id>.<timestamp>.<body>`).
- **Retries:** a network error, a timeout, a `408`, a `429` or a `5xx` gets one retry after 500 ms, within the ten seconds. Any `2xx` is success; anything else is a failure. askdare never reads the answer's body.
- **No queue.** There is no retry after the visitor was told: askdare has no database to keep one in. A receiver that is down for longer gets nothing, and the visitor sees `saved` (with `onLead`) or `failed`. If you need a queue, put it behind your own `onHandoff`.
- **Duplicates are possible:** an attempt that timed out may still have arrived before the retry. Drop them by `webhook-id`.

A receiver in another Next.js app, with nothing but Node.js:

```ts
// app/api/handoff/route.ts, in the app that receives requests
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChatHandoffReport } from '@boldare/askdare/next';

export async function POST(request: Request): Promise<Response> {
  const id = request.headers.get('webhook-id') ?? '';
  const timestamp = request.headers.get('webhook-timestamp') ?? '';
  const signatures = request.headers.get('webhook-signature') ?? '';
  const body = await request.text();

  const key = Buffer.from((process.env.HANDOFF_WEBHOOK_SECRET ?? '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  const valid = signatures.split(' ').some((entry) => {
    const [version, signature = ''] = entry.split(',');
    const given = Buffer.from(signature, 'base64');
    return version === 'v1' && given.length === expected.length && timingSafeEqual(given, expected);
  });
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 5 * 60;
  if (!valid || !fresh) return new Response(null, { status: 401 });

  const report = JSON.parse(body) as ChatHandoffReport;
  // Your ticket system: create a ticket once per report.id, and reply to report.contact?.email.
  await createTicket(report);
  return new Response(null, { status: 204 });
}
```

Answer quickly, within the four seconds of one attempt: create the ticket, or put the report on a queue of yours, and do the slow work later.

### Email

`emailHandoff({ to, from, send })` writes the report as a plain-text email and hands it to your `send` function, which uses whatever your app already sends mail with: Resend, Postmark, Amazon SES or nodemailer.

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler, emailHandoff } from '@boldare/askdare/next';
import nodemailer from 'nodemailer';
import { bots } from '@/askdare.config';

const transport = nodemailer.createTransport(process.env.SMTP_URL);

export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onHandoff: emailHandoff({
    to: 'support@example.com',
    from: 'chat@example.com',
    send: async ({ to, from, replyTo, subject, text }) => {
      await transport.sendMail({ to: [to].flat(), from, replyTo, subject, text });
    },
  }),
});
```

- **`replyTo`** is the visitor's email, from the form or the signed-in identity, so the person answers the visitor by replying. Without one, the email says the visitor left no address.
- **The subject** is fixed text with the bot and the reason, such as "Handoff request from support: a complaint". Nothing the visitor typed goes into a header, and line breaks are removed from every header as a second guard.
- **The body** lists the reason, who asked, the language and time, the handoff, conversation and visitor IDs (the visitor's is the pseudonym), the signed-in user, the contact details, and the summary and messages when `content` adds them. Your support inbox keeps it all.
- **Plain text only.** askdare writes no HTML email, so nothing from the conversation can carry a hidden link or a tracking image.
- **`send` must throw when the email wasn't sent,** or the visitor is told it was.

### Both, or your own

A transport is a function, so combine them in your own:

```ts
const webhook = webhookHandoff({ url: process.env.HANDOFF_WEBHOOK_URL ?? '', secret: process.env.HANDOFF_WEBHOOK_SECRET ?? '' });
const email = emailHandoff({ to: 'support@example.com', from: 'chat@example.com', send });

createChatHandler({
  bots,
  onHandoff: async (report) => {
    await Promise.all([webhook(report), email(report)]);
  },
});
```

If either throws, the visitor sees the request as failed (or saved), though the other may have gone out. A function of your own works the same way: create a ticket in your help desk, post to Slack, page someone on call. Resolve when it was delivered, throw when it wasn't, and never log the report.

## What `onHandoff` receives

`ChatHandoffReport`, from `@boldare/askdare/next`:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Random, the same on every retry: drop duplicates by it. |
| `bot` | `string` | The bot's ID. |
| `locale` | `string` | The chat's language. |
| `createdAt` | `number` | When the request was accepted, in epoch milliseconds. |
| `trigger` | `'model' \| 'visitor'` | The model's tool, or the visitor's button. |
| `reason` | `string` | One of the five [reasons](#who-asks-for-a-person). |
| `visitor` | `string` | The same pseudonym (HMAC) `onUsage`, `onFeedback` and `onTranscript` report. |
| `identity` | `VisitorIdentity` | The signed-in user, verified. Absent for anonymous visitors. |
| `conversationId` | `string` | The conversation in your conversation store, so your code can read it. Never sent to the browser. |
| `available` | `boolean` | `false` for a message left while nobody was available, which reaches `onHandoff` only when the app has no `onLead`. |
| `contact` | `Record<string, string \| boolean>` | The form's values by field name, or `{ email }` from a signed-in identity. Absent without either. |
| `summary` | `string` | The model's note for the person, with `content: 'summary'` or `'transcript'`. Absent for the button, and when the model wrote none. |
| `transcript` | `{ role, text }[]` | The visible messages of the conversation's latest history page, oldest first, with `content: 'transcript'` only: at most 50 messages and 64 KB, the oldest cut first. The same text the chat shows, after output checks. |

What `content` adds:

| `content` | The request carries |
| --- | --- |
| `'none'` (default) | Nothing from the conversation: the reason, the contact details and the IDs. The person reads the conversation through `conversationId`, or asks the visitor |
| `'summary'` | Also the model's short note, when the model handed over |
| `'transcript'` | Also the visible messages: what the visitor wrote and the answers they saw |

Contact details are in every report: the visitor typed them for this purpose. Message content is there only when you choose `summary` or `transcript`, as with [`onTranscript`](configuration.md#ontranscript).

## Limits

A handoff reaches a person, so it costs someone's time and has its own budget, counted in the same store as the other [limits](configuration.md#handler-limits):

| Limit | Default | Range |
| --- | --- | --- |
| `perConversation` | 1 | 1 to 10. A second request in the conversation ends as `limited`. |
| `perVisitorPerDay` | 3 | 1 to 100, per visitor or signed-in user per UTC day, and the same per IP address. |
| `perBotPerDay` | 100 | Up to 1,000,000 for the bot per UTC day. When it runs out, `onError` hears once that day, and every request ends as `limited`. |

```ts
handoff: { form: 'handoff', limits: { perVisitorPerDay: 2, perBotPerDay: 50 } },
```

A request counts when it is accepted, before delivery, and a failed delivery stays counted. Besides these, the button's endpoint allows 5 requests a minute per visitor and answers `429` above that. The human check, same-origin and token checks apply as to every request.

## Privacy

What leaves your app, and where:

- **To your `onHandoff`:** the report above. Contact details always; message content only with `content: 'summary'` or `'transcript'`. From there it goes where your transport sends it: your webhook's receiver, or your mail provider and the inboxes in `to`. Name them in your privacy notice.
- **To the model:** with the model's tool on, the `handoff` call and its result, which are stored in the conversation like every tool call, including the summary when there is one. The form's values never go to the model unless you mark a field `toModel` ([Forms](forms.md#what-the-model-sees)).

What askdare keeps:

- **No request.** The report passes from the request to `onHandoff` and is gone. askdare never logs it.
- **A note in the conversation,** `[askdare:handoff]` with the state and a fixed sentence, no content. It lives wherever the conversation does, and is deleted with it.
- **Counters** for the limits, with visitor IDs and IP addresses in their names, as for every [rate limit](privacy.md#ip-addresses).
- **With an [admin store](admin.md),** a daily count per bot of handoffs by state. No conversation, visitor, reason or contact details.

See [Privacy](privacy.md#handoffs-and-leads) for the list to put in your notice.

## Costs

- **The visitor's button runs no model call.**
- **The `handoff` tool's definition is input on every model call** of a bot with `model: true`: a few hundred tokens, in the stable part of the prompt, so mostly billed as cached input after the first message.
- **A model's handoff** costs one more model call when the model writes its answer after the tool's result, as for any tool.

## Texts and styling

- **Texts:** `handoff.button`, `handoff.connecting`, `handoff.sent`, `handoff.sentTo`, `handoff.saved`, `handoff.unavailable`, `handoff.unavailableTitle`, `handoff.failed` and `handoff.limited`, in every built-in language. Override them with `widget.texts` ([Texts](texts.md)).
- **Parts:** `handoff` (the button) and `handoff-status` (with `data-state`), plus the [form's parts](forms.md#texts-and-styling) ([Styling](styling.md)).
- **In your own markup:** `HandoffButton` and `HandoffStatus` from `@boldare/askdare/react`, and `actions.handoff()` ([React](react.md#handoff-and-forms)).

## Check it

- Run the app and `npx @boldare/askdare doctor`: each bot with handoff lists "Handoff is on, and onHandoff receives the requests."
- Press the headset button (**Talk to a person**) and send the form. Your receiver or inbox gets the request, and the chat says "Done…".
- To see the other states, make `available` return `false` (a message to leave), or point `url` at a receiver that answers `500` (`saved` with `onLead`, otherwise `failed`).
- `onError` receives every failed delivery, by the error's class name.
