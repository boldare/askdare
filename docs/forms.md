# Forms and leads

A bot can show a small form under its answer: a lead's name and email, a callback number, a topic, consent to be contacted. You define the forms in server code; the model picks one by name when the conversation calls for it; the visitor fills it in; askdare validates the values on the server and hands them to your `onLead` function. askdare stores none of them ([ADR-0031](adr/0031-forms-and-leads.md)).

| | |
| --- | --- |
| Who defines the fields | You, with `defineForm`, from a fixed set of field types. The model never adds or changes a field |
| Who fills them in | The visitor. The model can't prefill a value |
| Where the values go | Your `onLead`, after the response. Not to the model, unless you mark a field `toModel` |
| What askdare keeps | Nothing of the values. The conversation gets a note that the form was sent |

Forms work everywhere the chat does: in the script-tag widget, inline, inside your page with React, and in your own page in the iframe. A form can also collect contact details for a [handoff to a person](handoff.md#contact-details).

## Add a form

```ts
// askdare.config.ts
import { defineBot, defineForm } from '@boldare/askdare';

const offer = defineForm({
  name: 'offer',
  description:
    'Contact details for a sales follow-up. Show it when the visitor wants a quote, a demo or a call.',
  title: 'Get an offer',
  fields: [
    { name: 'name', type: 'text', label: 'Name', required: true },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'company', type: 'text', label: 'Company' },
    {
      name: 'topic',
      type: 'select',
      label: 'What are you interested in?',
      options: [
        { value: 'pricing', label: 'Pricing' },
        { value: 'demo', label: 'A demo' },
        { value: 'other', label: 'Something else' },
      ],
      toModel: true,
    },
    { name: 'consent', type: 'consent', label: 'I agree to be contacted about my request.', required: true },
  ],
  submit: 'Send',
  done: 'Thanks! We’ll get back to you within one working day.',
});

export const bots = [
  defineBot({
    id: 'sales',
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: ({ locale }) =>
      `You answer questions about our products. Reply in the visitor's language; default to ${locale}. When the visitor wants a quote, a demo or a call, show the offer form instead of asking for their details in the chat.`,
    forms: [offer],
    widget: { disclosure: { privacyUrl: '/privacy' } },
  }),
];
```

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { bots } from '@/askdare.config';

export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onLead: async ({ id, bot, form, values, createdAt }) => {
    // Your CRM or sales inbox. Never log `values`: they are what the visitor typed.
    const response = await fetch(process.env.LEADS_WEBHOOK_URL ?? '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, bot, form, values, createdAt }),
    });
    if (!response.ok) throw new Error(`The CRM answered ${response.status}`);
  },
});
```

A bot whose forms the model may show needs `onLead`: without it the route doesn't load, since the visitor would be told "thanks" for values nobody receives. `npx @boldare/askdare doctor` lists "Forms are offered to the model, and onLead receives them." for the bot.

Run the app and write "I'd like a quote" in the chat. The answer comes with the form under it; send it, and your `onLead` receives the values.

## How the model shows a form

A bot with forms gets a reserved tool, `show_form`, whose only argument is the name of one of the bot's forms. Its description lists each form's `name` and `description`, so write the `description` for the model: what the form is for and when to show it. It never reaches the browser.

- **The model can't fill in a value.** A value copied from the conversation can be wrong, and one placed there by a prompt injection (another email address, a link) would look to the visitor like your site's own suggestion. The visitor types every value.
- **The model can't invent a field.** It picks a form by name; the fields are yours. A tool that let the model define fields is exactly what an injection would use to ask for a password in your site's own UI.
- **At most one form per turn,** and never on the turn's last step. A [handoff](handoff.md) that asks for its contact form counts as that form, so a `show_form` in the same answer is refused. The model is told the visitor sees the form, so it shouldn't ask for the same details in text.
- **`model: false`** keeps a form away from the model: it is then only for a [handoff](handoff.md#contact-details). It needs no `description`, and on its own doesn't make `onLead` required.
- A bot tool can't be named `show_form`.

Say in your instructions when to show which form, as in the example above. A model that asks for an email address in the chat when a form exists usually needs that sentence.

## What the visitor sees

- **The form under the answer** that showed it, with its title, a visible label on every field, "(optional)" on fields that aren't required, and the `submit` button.
- **It stays open** until it is sent, even if the visitor asks something else first: people often do. After a reload it is open again. A form you remove from the bot shows "This form is no longer available." (`form.expired`).
- **Errors by field,** checked in the browser first and again on the server: a required field left empty, an invalid email or phone number, a value too long, an option that isn't in the list. The first field with an error gets focus.
- **Once sent,** the form is replaced by its `done` text, or "Thanks! We’ve received your details." (`form.done`).
- **A `consent` field** links your privacy policy when the bot's `widget.disclosure` has a `privacyUrl`.

Sending a form runs no model call: the bot doesn't answer it. It learns that the form was sent with the visitor's next message (see [What the model sees](#what-the-model-sees)).

## Fields

| `type` | The visitor enters | Rules |
| --- | --- | --- |
| `text` | One line | At most 200 characters, or a lower `maxLength` |
| `email` | An email address | At most 254 characters; the domain is lower-cased |
| `phone` | A phone number | 6 to 20 characters: digits, spaces, `+`, `-`, `(` and `)`. No country rules |
| `textarea` | Several lines | At most 2,000 characters, or a lower `maxLength` |
| `select` | One of 2 to 10 options | Only an option's `value` is accepted |
| `consent` | A checkbox | `required` means it must be ticked |

Every field has:

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | `string` | required | `[a-z][a-z0-9_]{0,31}`, unique in the form: the key of the value in `onLead`. |
| `label` | `FormText` | required | Shown above the field, as plain text. At most 120 characters. |
| `required` | `boolean` | `false` | |
| `toModel` | `boolean` | `false` | The model sees this field's value after the form is sent. See [What the model sees](#what-the-model-sees). |
| `placeholder` | `FormText` | none | `text`, `email`, `phone` and `textarea` only. |
| `maxLength` | `number` | the type's limit | `text` and `textarea` only, up to the type's limit. |
| `options` | `{ value, label }[]` | required | `select` only: 2 to 10, `value` 1 to 100 characters and unique. |

Every string is trimmed and normalized, and control and invisible characters are refused (line breaks only in a `textarea`). Email and phone fields, and fields named `name`, `company` or `organization`, tell the browser what to fill in (`autocomplete`).

There are no other field types, no validation functions of your own and no fields that depend on others. That closed set is what the server can validate and the widget can draw without your site's code. For more, use your own page in the iframe ([Embedding](embedding.md#your-own-page-in-the-iframe)) or a form on your site.

### The form

`defineForm(definition)` checks the definition when your app starts and throws a `TypeError` listing every problem, like `defineBot`. Its types (`FormDefinition`, `FormField`, `FormFieldType`, `FormText`, `Form`) come from `@boldare/askdare`.

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | `string` | required | `[a-z0-9_]{1,32}`, unique in the bot: what the model picks it by, and the `form` in `onLead`. |
| `description` | `string` | required unless `model: false` | For the model only: what the form is for and when to show it. At most 1,000 characters. |
| `model` | `boolean` | `true` | Whether the model may show it. |
| `title` | `FormText` | required | Shown above the fields. At most 120 characters. |
| `fields` | `FormField[]` | required | 1 to 8, in the order shown. |
| `submit` | `FormText` | "Send" (`form.submit`) | At most 120 characters. |
| `done` | `FormText` | "Thanks! We’ve received your details." (`form.done`) | Shown once the form is sent. At most 300 characters. |

A bot has at most 10 forms (`forms` in `defineBot`), with unique names.

### Texts in several languages

Every `FormText` is a string, or a map by language tag, like the bot's `texts`. The chat picks the visitor's language, falls back to English, then to the first one given, and an open form follows a [language switch](texts.md):

```ts
const callback = defineForm({
  name: 'callback',
  description: 'A phone number for a callback. Show it when the visitor asks to be called.',
  title: { en: 'Request a callback', pl: 'Poproś o telefon' },
  fields: [
    { name: 'phone', type: 'phone', label: { en: 'Phone number', pl: 'Numer telefonu' }, required: true },
  ],
  done: { en: 'We’ll call you soon.', pl: 'Wkrótce zadzwonimy.' },
});
```

## What `onLead` receives

`onLead` runs after the response, so a slow CRM doesn't delay the visitor's "thanks". askdare keeps the function alive until it finishes. A throw goes to `onError` as `internal_error` with the name of the error's class only, never its message, since a CRM's error can quote the values; the lead is then lost, so retry inside the function if you need to.

`ChatLeadReport`, from `@boldare/askdare/next`:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Random: drop duplicates by it. |
| `bot` | `string` | The bot's ID. |
| `form` | `string` | The form's `name`. |
| `locale` | `string` | The chat's language. |
| `createdAt` | `number` | When the form was sent, in epoch milliseconds. |
| `values` | `Record<string, string \| boolean>` | Every field of the form by name, validated and normalized: text, `true` or `false` for `consent`, `''` for a field left empty. Whether `toModel` or not. |
| `visitor` | `string` | The same pseudonym (HMAC) `onUsage`, `onFeedback` and `onHandoff` report. |
| `identity` | `VisitorIdentity` | The signed-in user, verified. Absent for anonymous visitors. |
| `conversationId` | `string` | The conversation in your conversation store. Never sent to the browser. |
| `source` | object | `{ kind: 'model' }` for a form the model showed. `{ kind: 'handoff', reason, trigger, delivered: false, why }` for a message left through a [handoff's form](handoff.md#contact-details), because nobody was available (`why: 'unavailable'`) or the request couldn't be delivered (`'failed'`). |

A message left through a handoff is different in one way: `onLead` is awaited then, with ten seconds, because whether it succeeded decides whether the visitor sees "saved" or "failed".

### Store leads in your database

```sql
create table chat_leads (
  id text primary key,
  bot text not null,
  form text not null,
  visitor text not null,
  fields jsonb not null, -- `values` is a reserved word
  created_at timestamptz not null
);
```

```ts
import { db } from '@/lib/db'; // a pg Pool

createChatHandler({
  bots,
  onLead: async ({ id, bot, form, visitor, values, createdAt }) => {
    await db.query(
      `insert into chat_leads (id, bot, form, visitor, fields, created_at)
       values ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0)) on conflict (id) do nothing`,
      [id, bot, form, visitor, JSON.stringify(values), createdAt],
    );
  },
});
```

Give the table a retention, and keep leads by `visitor` so you can find one person's when they ask.

## What the model sees

By default, only that the form was sent: the conversation gets a note, `[askdare:form] <name> sent`, with a fixed sentence saying that the model doesn't see the values. The model won't ask again.

A field marked `toModel: true` also reaches the model: after the note, its values follow as a visitor message, one `label: value` line per field. It is a visitor message on purpose, so text the visitor typed never carries the authority of your instructions. The chat shows it as part of the form, not as a message.

Mark the fields the bot needs to go on helping, such as a topic or a product, not contact details. The model doesn't need an email address to say "thanks, we'll write to you", and a value marked `toModel` is stored in the conversation (at OpenAI, or in your own store) until it is deleted.

## Consent

A `consent` field is a checkbox with your own wording, linked to your privacy policy when the bot has `widget.disclosure.privacyUrl`. askdare doesn't require one: whether you need consent to contact the visitor, and how to word it, is yours to decide ([Compliance](compliance.md#2-personal-data-gdpr)). With `required: true`, the form can't be sent unticked, and `onLead` gets `consent: true`.

## Limits

- **Per visitor:** 5 forms a minute and 20 a day, and the same per IP address. Above that, the chat shows an error and the values stay to try again.
- **Once per form shown:** a form can be sent only once. A second submission answers `409`.
- **The form's handle** is bound to the bot, the conversation and the visitor or signed-in user, and works for 24 hours. A reload issues a fresh one.
- The same-origin, token and human checks apply as to every request.

## Privacy

What leaves your app, and where:

- **The values go to your `onLead`,** and from there wherever you send them: your CRM, a database, an inbox. Name that place in your privacy notice.
- **To the model,** only the values of fields marked `toModel`, and the form's name. Field labels and the form's title go to the browser as part of the bot's public configuration; `description` and `toModel` never do.

What askdare keeps:

- **No values.** They pass from the visitor's request to `onLead` (or `onHandoff`) and are gone. askdare never logs them. The [turn log](privacy.md#turn-log) holds the form's name and handle, never values.
- **A note in the conversation** that the form was sent, and the `toModel` values. They live wherever the conversation does, and are deleted with it.
- **Counters** for the limits, as for every [rate limit](privacy.md#ip-addresses).
- **With an [admin store](admin.md),** a daily count per bot of leads. No values.

See [Privacy](privacy.md#handoffs-and-leads).

## Costs

- **The `show_form` tool's definition is input on every model call** of a bot with forms the model may show: a few hundred tokens, more with many forms and long descriptions. It sits in the stable part of the prompt, so it is mostly billed as cached input after the first message.
- **Sending a form costs nothing:** no model call, no tokens.
- **A `show_form` call before the answer** takes one more model call, as for any tool. After the answer, the server answers the call itself and the turn ends.

## Texts and styling

- **Texts:** `form.submit`, `form.done`, `form.optional`, `form.choose` and `form.expired`, and the errors `error.form.required`, `error.form.consent`, `error.form.email`, `error.form.phone`, `error.form.tooLong`, `error.form.option` and `error.form.invalid` ([Texts](texts.md)). The form's own `title`, labels, `submit` and `done` come from `defineForm`.
- **Parts:** `form` (with `data-ask-form` and `data-purpose`), `form-title`, `form-field` (with `data-type`), `form-optional`, `form-error`, `form-submit` and `form-done` ([Styling](styling.md)).
- **In your own markup:** the `Form` primitive, or your own form with `actions.submitForm(handle, values)` from `useChat()` ([React](react.md#handoff-and-forms)).
