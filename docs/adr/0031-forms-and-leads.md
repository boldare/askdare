# ADR-0031: Forms in the chat and leads

- **Status:** Proposed
- **Date:** 2026-11-26
- **Related:** [ADR-0030](0030-handoff.md) (a handoff collects contact details with a form, and falls back to one when nobody is available). Built by tasks 0.7-p3 (fields and validation), c1 (protocol), c2 (chat state), c3 (bot and handler) and c4 (UI).

## Context

Sales and support bots ask for structured data: a lead's name and email, a callback number, a topic, consent to be contacted. Asking in free text works badly: the model has to parse "my email is anna at example dot com", the value passes through the model and the conversation whether or not it needs to, and nothing validates it. Hosted products (Intercom Fin, Chatbase) show a small form in the chat instead and send its values to a CRM or a webhook.

What askdare has to build on:
- **Reply options ([ADR-0015](0015-reply-options.md)) and tool cards ([ADR-0017](0017-tool-renderers.md))** set the path for UI from the server: the server's code builds a small, typed, size-capped payload, sends it as its own protocol event with its own limits, and the client renders it with known components, as plain text.
- **Tool cards render only with the site's `toolRenderers`.** The script-tag widget draws nothing for them (ADR-0017), so a form built on `tool.ui` alone would not reach most installs.
- **[ADR-0004](0004-threat-model.md):** the client chooses nothing the server must decide, and every endpoint has same-origin, token and rate checks.
- **[ADR-0021](0021-zod-stays-a-required-peer.md):** Zod is always there on the server; the browser bundles can't take it (ADR-0028's 34 KB budget for the React entry, 14 KB for the iframe).
- **[ADR-0019](0019-compliance-and-guardrails.md):** consent and the privacy link are the operator's choice; askdare provides the means.
- **[ADR-0022](0022-guardrails-implementation.md):** what the server decided is recorded in the conversation as fixed developer notes without content.
- **[ADR-0014](0014-runtime-language.md):** the chat can switch language in place, from the bot's public configuration.

## Decision

### 1. Forms are defined in server code only, from a closed set of fields

```ts
const contact = defineForm({
  name: 'contact',                         // [a-z0-9_]{1,32}, unique in the bot
  description: 'Contact details for a sales follow-up. Show it when the visitor wants an offer or a call.',
  title: { en: 'Get an offer', pl: 'Zapytaj o ofertę' },
  fields: [
    { name: 'name', type: 'text', label: { en: 'Name', pl: 'Imię' }, required: true },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'phone', type: 'phone', label: 'Phone' },
    { name: 'topic', type: 'select', label: 'Topic', options: [{ value: 'pricing', label: 'Pricing' }, { value: 'demo', label: 'A demo' }], toModel: true },
    { name: 'message', type: 'textarea', label: 'Message' },
    { name: 'consent', type: 'consent', label: 'I agree to be contacted about my request.', required: true },
  ],
  submit: 'Send',
  done: "Thanks! We'll be in touch.",
});

defineBot({ forms: [contact], /* … */ });
```

- **Field types are a closed set:** `text` (at most 200 characters), `email` (at most 254), `phone` (digits, spaces, `+`, `-`, `(`, `)`, 6 to 20 characters; no country rules in 0.7), `select` (2 to 10 options, values from the definition), `textarea` (at most 2,000) and `consent` (a checkbox; `required` means it must be ticked). Each has `name`, `label`, optional `required`, `placeholder` (`text`, `email`, `phone`, `textarea`) and `toModel` (point 5). A `text` or `textarea` may set a lower `maxLength`.
- **Limits, checked by `defineForm` at startup:** at most 8 fields and 10 forms per bot; labels and titles at most 120 characters, `done` at most 300; names unique. An invalid form fails startup with the reason, like an invalid bot.
- **Texts per language:** every label, title, `submit` and `done` is a string or a map by language tag, as the bot's `texts` are. The server resolves them for the visitor's language, falling back to English, then to the first one given.
- **`description` is for the model only** and never reaches the client. A form with `model: false` is not offered to the model at all; it serves a handoff (ADR-0030) only.
- **No custom field types, no validation functions, no conditional fields in 0.7.** The closed set is what the server can validate and the widget can draw without the site's code; the rest is an `embedPath` page or a site's own form.

### 2. The model picks a form by name and never invents fields

- **A reserved tool `show_form`** with the strict schema `{ form }`, where `form` is an enum of the bot's forms offered to the model. Its description lists each form's name and `description`. `defineBot` rejects a bot tool with that name. The tool is offered through `allowed_tools`, never on the turn's last step (ADR-0015), and once per turn at most.
- **No prefilled values in 0.7.** The model can't pass values it heard in the conversation. A value copied by the model can be wrong, and one placed by a prompt injection (a different email address, a link) would look to the visitor like the site's own suggestion. The visitor types every value.
- **The server answers the call itself** with a fixed output, as it does `suggest_replies`: `{"status":"shown"}` and a sentence telling the model the visitor sees the form, that it shouldn't ask for the same fields in text, and that it will be told when the form is sent. It runs no bot code.

### 3. How it is shown: its own `form` event and a built-in form, not `tool.ui`

- **The public description travels in the bot's public configuration.** `GET /config/<bot>` and the chat document get `forms`: for each form its name, title, fields (name, type, label, required, placeholder, options with value and label, max length), `submit` and `done`, in the visitor's language. Never `description`, `toModel` or `model`. A language switch (ADR-0014) refetches the configuration, so an open form changes language with the rest of the chat.
- **A new event `form { messageId, callId, name, handle, purpose }`** tells the chat to show a form under that answer. `name` picks the description from the configuration; `handle` is the submission handle (point 4); `purpose` is `lead`, `handoff` or `message` (a handoff form while nobody is available, ADR-0030), which picks the texts around it. It comes once the step's calls are done, in call order, like `tool.ui`.
- **The chat renders it with built-in components:** a headless primitive `Form` with the parts `form`, `form-field`, `form-error` and `form-done`, and the default look in the skin. It works in the script-tag widget, inline, and in an `embedPath` page. Labels and options render as plain text; a `consent` field links the bot's `privacyUrl` (ADR-0019) through the `Link` primitive when one is set. Every field has a visible label, errors are tied to their field with `aria-describedby`, and the first invalid field gets focus (WCAG 2.2 AA, ADR-0019).
- **A form stays open** under its answer until it is sent or its handle expires, even after the visitor writes more: a visitor often asks a question before filling it in. Once sent, it is replaced by `done`.
- **Custom look:** the parts and theme variables; a headless chat builds its own form from `useChat()`, which exposes the forms of each message and `actions.submitForm(handle, values)`. Forms don't go through `toolRenderers`.
- **History:** a message gets an optional `forms: [{ callId, name, handle?, state }]` with `state` `open`, `sent` or `expired`, rebuilt from the stored `show_form` calls and the developer notes of point 5. A reload shows an open form open again, with a fresh handle.

### 4. How it is submitted: a new endpoint

- **`POST /forms { botId, resumeToken, form, values }`** with the access token, where `form` is the handle and `values` a JSON object of strings and booleans.
- **The handle** is an encrypted token like the feedback handle (ADR-0012): bound to the bot and to the visitor or signed-in user, holding the conversation, the `callId`, the form's name, its purpose and, for a handoff, the handoff's reason and trigger. It is valid for 24 hours. The client never names the form or the conversation itself.
- **Checks, in order:** same origin and the access token, as every endpoint; the handle belongs to this visitor and bot, and the resume token to the same conversation; the per-visitor limits (5 submissions a minute, 20 a day, and the same per IP); the form hasn't been sent already (the conversation has no submitted note for this `callId`; the note is appended with the version check of the store, so two concurrent submissions can't both pass); then **validation**.
- **Validation with Zod on the server,** built from the form's definition: unknown keys are refused, strings are trimmed and normalized (NFC), control and invisible characters other than line breaks in a `textarea` are refused, emails lower-cased in the domain part, `select` values must be one of the options, a required `consent` must be `true`. The widget checks the same rules by hand first, for quick errors, without Zod.
- **Answers:**
  - `200 { state: 'sent' }`, or for a handoff form `{ state: 'sent', handoff }` with ADR-0030's final state;
  - `400` with `invalid_input` and `fields: { <name>: <error key> }` (`error.form.required`, `error.form.email`, `error.form.phone`, `error.form.tooLong`, `error.form.option`), never echoing a value;
  - `409` when the form was already sent; `404` for a handle of someone else, another bot or a forged one; `429` over a limit.
- **A submission is not a model turn.** No model call, no tokens, no stream: the chat shows `done` (or the handoff's state). What the model learns comes with the next turn (point 5). A form that triggers an answer from the bot can come later as an option, if asked for.

### 5. What the model sees after a submission: "sent" by default, chosen fields on opt-in

- **Always:** a fixed developer note, `[askdare:form] <name> sent`, with a fixed sentence saying the visitor sent the form and that the model doesn't see its values. No content, as in ADR-0022. It tells the model not to ask again, and history uses it for the form's state.
- **Values only for fields marked `toModel: true`.** Their values follow the note as a **user** message, `[askdare:form-values]` and one `label: value` line per field, so text the visitor typed never carries developer authority. History shows it as part of the form, not as a visitor message, and only right after its note; a visitor who types the marker gets a plain message. The default is `false` for every field.
- **The recommendation** for the docs: mark fields the bot needs to go on helping (a topic, a product), not contact details. The model doesn't need an email address to say "thanks, we'll write to you".

### 6. What `onLead` gets

`createChatHandler({ onLead })`, `onLead: (report: ChatLeadReport) => void | Promise<void>`, called after the response like `onFeedback` (`waitUntil`), so a slow CRM doesn't delay the visitor's "done". A throw goes to `onError` as `internal_error` with the error's class name only, as for `onTranscript`, since a CRM's error message can quote the values. The report:
- `id`: random, for the receiver to drop duplicates;
- `bot`, `form` (its name), `locale`, `createdAt`;
- `values`: the validated, normalized values, every field of the form, `toModel` or not;
- `visitor`: the pseudonym; `identity`: the signed-in user, if any; `conversationId`: raw, never sent to the client;
- `source`: `{ kind: 'model' }`, or `{ kind: 'handoff', reason, trigger, delivered: false, why: 'unavailable' | 'failed' }` for a handoff saved as a message (ADR-0030).

A bot whose forms are offered to the model needs `onLead`: without it, the handler refuses to start and `askdare doctor` says why. **Values are never logged,** by askdare or its transports, and the report is listed in `docs/privacy.md` with `onTranscript` as a hook that carries personal data.

### 7. Forms and handoff (agreed with ADR-0030)

- A handoff's `form` is a form of the bot, usually with `model: false`. Its values go to **`onHandoff`** as `contact` when the handoff is delivered.
- When nobody is available, the same form is shown with `purpose: 'message'`, and its values go to **`onLead`** with `source.kind: 'handoff'` and `why: 'unavailable'`. When the delivery fails after the form was sent, they go to `onLead` with `why: 'failed'`. The visitor sees ADR-0030's `saved` either way.
- Without `onLead`, a message left while nobody was available goes to `onHandoff` with `available: false`; a failed delivery ends as `failed`.
- A handoff form doesn't count against the lead limits twice: one submission, one count.

### 8. Consent, and what askdare keeps

- **Consent is a field,** `type: 'consent'`, with the site's own wording. When the bot's `widget.disclosure` has a `privacyUrl`, the field links it. askdare requires no consent field: whether one is needed, and its wording, is the operator's decision, which the compliance guide (`docs/compliance.md`) helps with.
- **askdare stores no values.** They pass from the request to `onLead` or `onHandoff` and are gone. In the conversation there is only the note, plus the `toModel` values the operator chose, which then live wherever the conversation does (OpenAI or the app's own store) and are deleted with it.
- **The turn log** ([ADR-0027](0027-stream-resume.md)) holds the `form` event (name and handle), never values, since values don't travel in a turn.

## Consequences

- **New public API (ADR-0006, listed by task z1):** `defineForm` and its field types; `forms` in `defineBot`; `onLead` and `ChatLeadReport`; the reserved tool name `show_form`; the `form` event, the `forms` field of the public configuration and of history, `POST /forms` and its error keys; the `Form` primitive and its parts, `actions.submitForm`; the `form.*` and `error.form.*` texts.
- **Forms work in every install,** the script-tag widget included, without the site writing components. The price is bytes: the `Form` primitive and its skin go into the React entry and the iframe app, which is why task b1 makes room in the React entry first. Task c4 measures them.
- **Personal data reaches the app, not the model,** by default. A bot that needs a value to go on helping marks that field, and the operator's privacy notice covers it.
- **A conversation holds a note per sent form,** a few tokens in later turns.
- **The `show_form` tool costs input tokens on every step** of a bot with forms offered to the model, inside the cached prefix, as `suggest_replies` does.
- **The closed set of fields will be asked to grow** (dates, numbers, file uploads, several pages). Each addition is a minor release with its validation rule, not an escape hatch.

## Open questions for the maintainer

Recommendations are in the decision above; these are the calls to confirm when accepting it.
- **Values to the model:** per field with `toModel` (recommended), per form, or never in 0.7.
- **A submission that runs a model turn,** so the bot answers the form: left out of 0.7 (recommended), or an option now.
- **Prefilled values from the model:** refused in 0.7 (recommended); revisit with a rule such as "only values the visitor typed in this conversation".
- **`onLead` required** when a form is offered to the model (recommended), or only a startup warning.

## Alternatives considered

- **A form as a `tool.ui` card,** the developer's own tool returning fields through `ui`. It reaches only sites with `toolRenderers` (not the script-tag widget), puts validation in every site's code and lets the tool's output decide fields at runtime, so the server couldn't validate a submission against a fixed definition.
- **The model defines the fields** (a `show_form` with a list of fields as arguments). Flexible, and exactly what a prompt injection would use to ask for a password or a card number in the site's own UI.
- **Submitting as a visitor message** (the values written into `POST /messages`, as a reply option is). Every value would reach the model and the conversation, and validation would run in the middle of a turn.
- **The form's description in the `form` event** instead of the public configuration. Self-contained, but it repeats the fields in every event and history page, and an open form couldn't follow a language switch.
- **Values to the model by default.** Simpler for bots that want to use them, but sends contact details to OpenAI and keeps them in the conversation for every bot, which most don't need.
- **Values in the developer note.** One item instead of two, but text the visitor typed would carry developer authority: a prompt injection through a form field.
- **A submission that runs a model turn.** Lets the bot answer the form in its own words, at the cost of a model call per submission and the values in the prompt. Left as a possible option.
- **askdare stores leads** (in the rate-limit store, or the admin store of ADR-0032). The core stays without a database; the admin add-on can record leads from `onLead` like it records ratings, if it chooses to.
- **Validation in the browser only, or with a shared Zod schema in the browser.** The client is untrusted, and Zod doesn't fit the browser budgets; the server is the authority and the client's hand-written checks only speed up the errors.
