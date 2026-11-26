# Wire protocol (version 1)

This is how the askdare server streams a chat turn to its clients: the widget's iframe app and `@boldare/askdare/react`. The protocol belongs to askdare; raw OpenAI stream events are never forwarded ([ADR-0002](adr/0002-openai-only-no-leaked-types.md)).

Source of truth: `packages/askdare/src/protocol/`.

## Endpoints

Every path sits under the route's base path: `/api/chat` by default, or `basePath` in `createChatHandler`. Any other path or method answers `404`.

| Method and path | Token | Purpose |
| --- | --- | --- |
| `GET /widget.js` | None | The loader script for your pages. `?bot=<id>` adds that bot's launcher look |
| `GET /embed/<bot>` | None | The chat document in the iframe. `?lang=<tag>` carries the embedding page's language for `locale: 'auto'`, and `?mode=inline` marks a chat inside the page |
| `GET /config/<bot>` | None | The bot's public configuration in one language, for switching the chat's language in place. `?lang=<tag>` picks the language for `locale: 'auto'` |
| `GET /theme/<bot>.css` | None | The bot's theme and `widget.css`, with a content hash in `?v=` |
| `GET /assets/<file>` | None | The chat's script and stylesheet, and the preset fonts |
| `POST /session` | None | Starts or renews a visitor's session and answers an access token ([Identity](#identity)) |
| `POST /messages` | Access token | Sends a message and answers with the event stream ([Events](#events)) |
| `POST /history` | Access token | The visible messages of the visitor's conversation |
| `POST /resume` | Access token | The rest of an answer whose stream dropped, as an event stream ([Resuming an answer](#resuming-an-answer)) |
| `POST /feedback` | Access token | Rates one answer ([Feedback](#feedback)) |
| `POST /handoff` | Access token | Asks for a person, from the chat's button ([Handoff](#handoff)) |
| `POST /forms` | Access token | Sends a form shown in the chat ([Forms](#forms)) |
| `DELETE /conversation` | Access token | Deletes the visitor's conversation, and its files when the bot accepts attachments |
| `POST /attachments` | Access token | Uploads one file ([Attachments](#attachments)) |
| `POST /transcriptions` | Access token | Transcribes one dictation ([Dictation](#dictation)) |
| `POST /doctor` | Doctor token | Checks the setup for `askdare doctor` ([Diagnostics](#diagnostics)) |

- **`POST /messages`** takes `{ "botId", "text", "resumeToken"?, "attachments"?, "context"?, "locale"? }`. Without `resumeToken`, the server starts a new conversation and sends `conversation.created`. `locale` is the visitor's language tag, passed to the bot's instructions.
- **`POST /history`** takes `{ "botId", "resumeToken", "before"? }` and answers `{ "messages": [{ "id", "role", "text", "citations", "attachments", "feedback"?, "replies"?, "ui"?, "handoff"?, "forms"? }], "before"? }`, where `attachments` is a count, `feedback` is the answer's rating handle (see [Feedback](#feedback)), `replies` are the options of the latest answer (see [Reply options](#reply-options)), `ui` are the tool payloads of an answer (see [Tool UI](#tool-ui)), `handoff` is the state of a handoff recorded after an answer (see [Handoff](#handoff)) and `forms` are the forms shown under an answer (see [Forms](#forms)). It answers one page of the conversation, oldest message first (see [History pages](#history-pages)).
- **`POST /resume`** takes `{ "botId", "resumeToken", "messageId", "after" }` and answers an event stream: the answer's events after `after`, then the live ones (see [Resuming an answer](#resuming-an-answer)).
- **`DELETE /conversation`** takes `{ "botId", "resumeToken" }` and answers `204` with no body.
- **`GET /config/<bot>`** answers the same public configuration the chat document carries: texts, greeting, starters, theme variants, the bot's forms (see [Forms](#forms)) and the other widget settings, never the model, instructions, tools or vector stores. For a bot with `locale: 'auto'`, `?lang=` picks the language; without it, the browser's `Accept-Language` does, then English. A bot with a fixed locale ignores `lang`. An invalid tag answers `400` with `invalid_input`, an unknown bot `404`. Responses are cached for five minutes (`no-cache` in development) and vary by `Accept-Language`. `Content-Language` names the language the texts are written in, for the chat document's `lang`: the visitor's when the bot has texts for it, else English for a language without a built-in dictionary.
- **Same origin only.** Every `POST` and `DELETE` except `/doctor` refuses cross-site requests with `401`. The API serves the chat's own iframe, which runs on the same origin.

## History pages

A long conversation comes back in pages of whole turns, newest page first ([ADR-0024](adr/0024-conversation-store.md), decision 7):

- **The latest page.** Without `before`, `POST /history` answers the latest page, as it did before paging. Clients that never send `before` keep working and see the latest page only.
- **Older pages.** When older messages exist, the answer has `before`. Send it back as `before`, with the same `botId` and `resumeToken`, for the page before. The oldest page has no `before`.
- **Whole turns.** A page is about 100 stored items and is extended back to the visitor message that starts its oldest turn, so a turn (a visitor message and the answers to it) is never split between pages. Each page starts with a visitor message, except the oldest when the conversation starts otherwise, and except after a single turn of more than about 800 stored items (hundreds of tool calls), which is split rather than read without end.
- **What pages carry.** Every answer has its own cards (`ui`) and rating handle on whichever page it is. Only the latest answer has `replies`, so only the latest page can. With output checks, an answer shows on its page only once it is settled ([ADR-0022](adr/0022-guardrails-implementation.md)).
- **The cursor.** `before` is opaque, at most 4,096 characters, and valid as long as a resume token (30 days by default), for its conversation only. A cursor that is forged, expired or from another conversation, even the same visitor's, answers `400` with `invalid_input` and the key `error.history`; load the latest page again. The resume token still decides who may read the conversation: a cursor grants nothing on its own.
- **Between pages.** New turns land on the latest page and don't shift older pages, so a client keeps the cursors it has while the conversation goes on.

Older clients ignore `before` in the answer, so paging is additive in protocol version 1.

## Resuming an answer

A visitor's connection can drop in the middle of an answer: a train tunnel, a phone switching networks, a proxy timeout. The answer goes on being written on the server, and the client can pick it up where it stopped ([ADR-0027](adr/0027-stream-resume.md)).

- **Sequence numbers.** Every event frame of `POST /messages` and `POST /resume` carries an SSE `id:` with the event's sequence number in its turn: 1 for the turn's first event, then one more for each event, without gaps. Comments (`: ok`, `: ping`) carry none. Keep the `id` of the last event you received.
- **The request.** `POST /resume` takes `{ "botId", "resumeToken", "messageId", "after" }`: the conversation's resume token, the `messageId` of the answer's `message.start`, and `after`, the last sequence number received (`0` for none). `messageId` is 1 to 128 characters; `after` is a whole number from `0`. The client reads the answer with `fetch`, as it does `POST /messages`, so there is no `Last-Event-ID` header.
- **The answer.** An event stream with the same headers and framing as `POST /messages`: the answer's events after `after` in order, then the live ones as the server writes them, until `message.end` or `error`. Each event comes once, with the sequence number it had on the first stream, so appending what arrives to what was shown continues the answer without duplicates. When `after` is already the answer's `message.end` or `error`, the stream ends at once, empty.
- **A stream that ends without `message.end` or `error`.** The answer's events expired or could no longer be kept, the answer ran out of time without ending, or the connection dropped again. Resume again; a `404` then says the answer can't be resumed.
- **`404` with `not_found`.** The answer is unknown, its events expired (a few minutes after the answer's last event: the bot's turn timeout plus one minute), the conversation isn't the visitor's or no longer exists, the resume token is invalid, or the server keeps no turn log. Reload the history instead: a finished answer is there.
- **Who can resume.** The answer is found from the conversation in the resume token, never from the request alone, and the token must belong to the visitor or signed-in user of the access token. A `messageId` from another conversation, even the same visitor's, answers `404`.
- **Before `message.start`.** Without its `messageId`, a client can't resume. Reload the history.
- **Where it works.** The answer resumes when the reconnect reaches a server that has its events: with the default in-memory log, the same instance; with a shared log such as `upstashTurnLog()`, any. See [Configuration](configuration.md#resume).
- **Rate limit.** 30 resumes per visitor per minute, then `429` with `rate_limited`.

What askdare's own chat does, in the widget, inside a page and with the headless API:

- **When.** A stream of `POST /messages` or `POST /resume` that ends without `message.end` or `error`: the connection dropped, it failed, or the watchdog gave up. A turn the chat stopped itself (the chat unmounted, or switched languages) is not resumed.
- **How often.** After half a second, then 2 and 8 seconds: three attempts in a row that bring nothing new, at most ten for one answer, so a connection that keeps dropping stays well under the rate limit. Meanwhile the chat's status says "Reconnecting…" (`status.reconnecting`), which screen readers hear politely.
- **Duplicates.** Events whose `id` is not above the last one received are ignored, so text already shown is never shown twice.
- **Giving up.** On any answer other than `200` (`404`, `429` or another), after the attempts, or without a `messageId`, it loads the latest page of the history. When the history's last turn is the visitor's message with an answer after it, that answer replaces the one shown; otherwise the chat shows the connection problem, and the answer shows on the next load.

Older clients ignore the `id:` field, and the endpoint is new, so resuming is additive in protocol version 1.

## Transport

- **Request:** `POST` with a JSON body and a `Bearer` access token. No cookies.
- **Response:** Server-Sent Events. Clients read them with `fetch` and a `ReadableStream`, because `EventSource` can't send a POST body.
- **Response headers:**
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `X-Accel-Buffering: no`
  - `x-askdare-protocol: 1`
- **Framing:** one event per frame: `id: <sequence number>`, then `event: <type>`, then `data: <json>`, then a blank line. The JSON always repeats `type`. The `id` is the event's sequence number in its turn, for [resuming](#resuming-an-answer).
- **First byte:** the server sends a comment (`: ok`) before contacting OpenAI. Heroku requires a first byte within 30 s.
- **Heartbeat:** a `: ping` comment every 15 s, on a timer that is independent of model output. Heroku closes connections after 55 s without bytes.

## Events

| Type | Payload | Meaning |
|---|---|---|
| `conversation.created` | `resumeToken` | A new conversation started; store the token to resume it later |
| `user.ack` | `messageId` | The server accepted the user's message and assigned it this ID |
| `message.start` | `messageId` | The assistant started a reply |
| `reasoning` | `messageId`, `state: started \| done` | The model is thinking; show a status, never content |
| `text.delta` | `messageId`, `delta` | Append text to the reply (markdown) |
| `citation` | `messageId`, `index`, `title`, `url?` | Source for marker `[index]`; `url` is http(s) only |
| `tool.status` | `messageId`, `callId`, `name`, `state: running \| done \| error` | A tool ran; arguments and results stay on the server. `name: file_search` is the knowledge base search |
| `tool.ui` | `messageId`, `callId`, `name`, `data` | What a tool picked from its result for the visitor ([Tool UI](#tool-ui)); after the step's `tool.status` events, at most four per answer |
| `replies` | `messageId`, `items` | Options the visitor can click instead of typing ([Reply options](#reply-options)); at most once, before `message.end` |
| `handoff` | `messageId`, `state` | Where a handoff the model asked for stands ([Handoff](#handoff)); `requested`, then the final state |
| `form` | `messageId`, `callId`, `name`, `handle`, `purpose` | A form to show under the answer ([Forms](#forms)); after the step's `tool.status` events |
| `message.end` | `messageId`, `reason`, `resumeToken?`, `feedback?` | The reply finished. A resumed conversation gets a fresh `resumeToken`, so it stays reachable 30 days after its last message. `feedback` is the answer's rating handle, when answers can be rated. Reasons: `completed`, `max_steps`, `max_output_tokens`, `timeout`, `content_filter`, `aborted` |
| `error` | `code`, `message`, `retryAfterMs?`, `key?`, `params?` | The turn failed; `message` is safe to show ([keys and parameters](#error-keys-and-parameters)) |

## Attachments

When a bot has `attachments` enabled, files travel separately from the message:

1. `POST /attachments` with the raw file as the body (`Content-Type: application/octet-stream`), the `Bearer` token, and two headers: `x-askdare-bot` (bot ID) and `x-askdare-filename` (URL-encoded name). The server detects the type from the bytes, uploads the file to OpenAI and answers `{ "attachment": { "id", "kind": "image" | "pdf", "name", "size" } }`.
2. `POST /messages` with `"attachments": ["<id>", …]` next to `text`. `text` may be empty when files are attached.

`id` is an encrypted handle bound to the bot and the visitor, valid for 1 hour. OpenAI file IDs never reach clients, and the server refuses raw file IDs. History (`POST /history`) reports only how many files a message had.

## Dictation

When a bot has `voice` enabled, `POST /transcriptions` takes a recording as the raw body (`Content-Type: application/octet-stream`) with the `Bearer` token and two headers: `x-askdare-bot` (bot ID) and `x-askdare-languages` (comma-separated language tags, used as hints). It answers `{ "text": "…" }`. Clients put the text in the message field for the visitor to check; nothing is sent to the model.

## Feedback

When the app sets `onFeedback` and the bot allows it, every answer comes with a rating handle: in `message.end` while it streams, and on the same answers in `POST /history`. An answer that output checks replaced has none, after a reload either ([ADR-0022](adr/0022-guardrails-implementation.md)). A handle is `{ "handle", "key" }`:

- `handle` is opaque and encrypted, bound to the bot and to the visitor or signed-in user. It holds the conversation and the answer, which the client never sees.
- `key` is a hex string that stays the same for the answer across reloads, so a client can remember the visitor's own rating.

`POST /feedback` takes `{ "botId", "feedback", "rating", "comment"? }` with the `Bearer` token, where `feedback` is the `handle`, `rating` is `"up"`, `"down"` or `null` to take a rating back, and `comment` holds at most 500 characters. It answers `204` with no body. A handle of another visitor, another bot or a forged one answers `404`, as does a bot whose answers can't be rated. Ratings are limited per visitor (`429`).

## Reply options

An answer can offer a few options the visitor clicks instead of typing ("Yes, book it", "Show prices"). With `widget.replies: 'suggest'`, the model suggests them through the built-in tool `suggest_replies`, and the server answers that call itself. They come in a `replies` event, `{ "messageId", "items": ["…"] }`, sent at most once per answer, before its `message.end`. After a reload, `POST /history` returns them as `replies` on the latest answer, as long as the visitor hasn't written since ([ADR-0015](adr/0015-reply-options.md)). How to use them in a bot: [Reply options](reply-options.md).

- **Limits.** One to four items, each trimmed, on one line, 1 to 80 characters (UTF-16 code units), all different, with nothing the visitor can't see (control, format, private-use or unassigned characters; the zero-width joiner in emoji is fine), and without links: no scheme such as `https://` or `mailto:`, no `www.`, no IP address and no domain name such as `example.com`. The server drops items that break these rules and sends no event when none is left; clients refuse an event that breaks them.
- **Plain text.** Show each item as text, never as Markdown or HTML.
- **Only under the latest answer.** Hide the options as soon as the visitor sends anything.
- **A click is a message.** Send the item's text through `POST /messages` like typed text. The server can't tell the difference, and nothing else travels with it.

Older clients ignore the event, so it is additive in protocol version 1.

## Tool UI

A tool can pick fields from its result for the visitor to see as a card, list or table, drawn by a component the site registers ([ADR-0017](adr/0017-tool-renderers.md)). The payload comes in a `tool.ui` event, `{ "messageId", "callId", "name", "data" }`: `callId` is the same opaque ID as in `tool.status`, `name` is the tool's name, which picks the component, and `data` is whatever the tool's `ui` function returned. The events of a step come once all its calls are done, in call order, before the model writes on. After a reload, `POST /history` returns them as `ui: [{ "callId", "name", "data" }]` on the answer they belong to, for every answer, not only the latest; a turn that ended without a visible answer has none to carry them. How to define them: [Tools](tools.md#cards-for-the-visitor).

- **Limits.** `data` is plain JSON (objects, arrays, strings, finite numbers, booleans and `null`, but not `null` alone), at most 8 KB (8,192 bytes of UTF-8 JSON) and at most 8 levels of arrays and objects. An answer carries at most four, each `callId` once. The server drops a payload that breaks a limit whole and never cuts one; clients ignore an event that breaks one, and refuse a history that does.
- **Never a failed call.** A call that failed, timed out or returned too much data sends no `tool.ui`.
- **Never as HTML.** Render `data` with your own components as text, and links through a URL check; no client renders it as Markdown or HTML.
- **A click is a message.** A component acts only by sending a visitor message through `POST /messages`, as a reply option does.

Older clients ignore the event, so it is additive in protocol version 1.

## Handoff

A bot with `handoff` in `defineBot` can pass the conversation to a person: the model through the reserved tool `handoff`, the visitor through the chat's "Talk to a person" button ([ADR-0030](adr/0030-handoff.md)). The handoff is one-way: the request reaches a person through the app's `onHandoff`, who answers outside the chat, usually by email. The chat shows where it stands, in one of six states:

| State | Meaning | Text |
| --- | --- | --- |
| `requested` | Running, or waiting for its form | `handoff.connecting` |
| `sent` | Delivered to the app's `onHandoff` | `handoff.sent` |
| `saved` | Nobody was available, or the delivery failed, and the form's values went to `onLead` | `handoff.saved` |
| `unavailable` | Nobody was available and there was no form to leave a message in | `handoff.unavailable` |
| `failed` | The delivery failed and nothing saved the request | `handoff.failed` |
| `limited` | A handoff limit refused it | `handoff.limited` |

Show the state in plain text, never as Markdown.

- **From the model.** When the model calls the tool, the answer's stream carries `handoff` events: `{ "messageId", "state": "requested" }` as soon as the call is seen, then the final state once the step's calls are done, before the model writes on. When the bot collects contact details, a [`form`](#forms) event follows `requested` instead of a final state, and the final state comes from the form's submission.
- **From the button.** `POST /handoff` takes `{ "botId", "resumeToken" }` with the `Bearer` token and runs no model call. Nothing in the body chooses the reason, the recipient or the content. Show the button only once a conversation exists. It answers `200` with `{ "state", "form"? }`:
  - the final state, such as `{ "state": "sent" }`;
  - or `{ "state": "requested", "form": { "name", "handle", "purpose" } }` when the visitor has to fill in a form first: `name` picks its description from the configuration, `handle` goes to `POST /forms`, and `purpose` is `handoff` (contact details) or `message` (nobody is available: show `handoff.unavailableTitle` above the form). Only `requested` comes with a form.
- **A limit is a state.** A handoff over the bot's limits answers `200` with `limited`, which the chat shows. The endpoint's own burst limit still answers `429`. A bot without handoff answers `404`.
- **History.** After a reload, `POST /history` returns `handoff: { "state" }` on the answer the handoff was recorded after; for the button, on the latest answer at that time.

```text
event: handoff
data: {"type":"handoff","messageId":"msg_1","state":"requested"}

event: handoff
data: {"type":"handoff","messageId":"msg_1","state":"sent"}
```

```json
{ "state": "requested", "form": { "name": "contact", "handle": "eyJhbGciOiJkaXIi…", "purpose": "message" } }
```

Older clients ignore the event, the history field and the endpoint (an old widget has no button), so handoff is additive in protocol version 1.

## Forms

A bot can show a small form in the chat, defined in the server's code with `defineForm`: a lead's contact details, a callback number, a handoff's reply address ([ADR-0031](adr/0031-forms-and-leads.md)). The model picks a form by name through the reserved tool `show_form` and never defines fields or fills in values; the visitor types every value.

### The description, in the configuration

The bot's public configuration (`GET /config/<bot>` and the chat document) carries `forms`, absent for a bot without them: one to ten forms with distinct names, in the visitor's language. A language switch refetches the configuration, so an open form changes language with the rest of the chat. Nothing for the model (a form's `description`, `toModel` and `model`) is in it.

```json
{
  "forms": [
    {
      "name": "contact",
      "title": "Get an offer",
      "fields": [
        { "name": "name", "type": "text", "label": "Name", "required": true, "maxLength": 80 },
        { "name": "email", "type": "email", "label": "Email", "required": true, "placeholder": "you@example.com" },
        { "name": "topic", "type": "select", "label": "Topic", "required": false,
          "options": [{ "value": "pricing", "label": "Pricing" }, { "value": "demo", "label": "A demo" }] },
        { "name": "consent", "type": "consent", "label": "I agree to be contacted about my request.", "required": true }
      ],
      "submit": "Send",
      "done": "Thanks! We'll be in touch."
    }
  ]
}
```

- **A form:** `name` (`[a-z0-9_]`, 1 to 32 characters), `title`, `fields`, `submit` (the button) and `done` (shown in place of the form once it is sent).
- **A field:** `name` (a letter, then letters, digits, `_` or `-`, at most 64 characters, distinct in its form), `type`, `label` and `required`. One to eight per form.
- **Types:** `text` (at most 200 characters), `email` (254), `phone` (20), `textarea` (2,000), `select` and `consent` (a checkbox; `required` means it must be ticked). The four text types may have a `placeholder` and a lower `maxLength`. A `select` always has `options`: two to ten `{ "value", "label" }` with distinct values. Keys that don't belong to a field's type are ignored; an unknown type makes the whole list invalid.
- **Lengths** are UTF-16 code units, as JavaScript's `length` counts them: titles, labels, placeholders, option labels and `submit` 1 to 120, `done` 1 to 300, option values 1 to 200.
- **Plain text.** Render every text as text, never as Markdown or HTML. A `consent` field links the bot's `privacyUrl` when the disclosure has one.

### The `form` event

`{ "messageId", "callId", "name", "handle", "purpose" }` tells the chat to show a form under that answer. The events of a step come once its calls are done, in call order, like `tool.ui`. `callId` is opaque, `name` picks the description, `handle` is what `POST /forms` takes (encrypted, bound to the bot and the visitor, valid for 24 hours), and `purpose` picks the texts around it: `lead` (the model showed it), `handoff` (a handoff's contact details) or `message` (a handoff while nobody is available). A form stays open under its answer, even after the visitor writes more, until it is sent or its handle expires.

```text
event: form
data: {"type":"form","messageId":"msg_1","callId":"call_2","name":"contact","handle":"eyJhbGciOiJkaXIi…","purpose":"lead"}
```

After a reload, `POST /history` returns them as `forms: [{ "callId", "name", "purpose", "state", "handle"? }]` on their answer, one to ten with distinct `callId`s. `state` is `open`, `sent` or `expired`; an open form has a fresh `handle`.

### Sending a form

`POST /forms` takes `{ "botId", "resumeToken", "form", "values" }` with the `Bearer` token: `form` is the handle, and `values` an object by field name, with a string for each field and `true` or `false` for a `consent`. At most eight values, each string at most 4,000 characters; the form's own limits are checked after that. Nothing in the body names the form or the conversation: the handle does.

```json
{
  "botId": "support",
  "resumeToken": "eyJhbGciOiJkaXIi…",
  "form": "eyJhbGciOiJkaXIi…",
  "values": { "name": "Anna", "email": "anna@example.com", "topic": "demo", "consent": true }
}
```

- **Sent:** `200` with `{ "state": "sent" }`. A handoff's form adds the handoff's final state, `{ "state": "sent", "handoff": "sent" }`. Show `done`, or the handoff's state, in place of the form. A submission runs no model turn; the model learns the form was sent with the next message.
- **Refused fields:** `400` with `invalid_input` and `fields`, one error key per refused field. It never echoes a value. The keys are `error.form.required`, `error.form.email`, `error.form.phone`, `error.form.tooLong` and `error.form.option`; a later version may add others of the form `error.form.<name>`, which a client shows as a generic error for the field.

  ```json
  {
    "error": {
      "code": "invalid_input",
      "message": "Some fields are not valid.",
      "fields": { "email": "error.form.email", "consent": "error.form.required" }
    }
  }
  ```

- **Already sent:** `409` with `invalid_input` and the key `error.form.sent`.
- **Not this visitor's:** `404` with `not_found` for a handle of another visitor or bot, or a forged one.
- **Too many:** `429` with `rate_limited`, over 5 submissions a minute or 20 a day per visitor.

Older clients ignore the event and the history field and never call the endpoint, so forms are additive in protocol version 1.

## Identity

`POST /session` takes an optional `identityToken`: the JWT from `askdare('identify')`, or `null` to sign out. Without it, a renewal keeps the identity the previous access token had. Widgets send the page's latest token with every session request. The answer adds `identified` (boolean), `identityKey` (an HMAC that tells users apart without revealing them; widgets keep one conversation handle per key), `resumeToken` when signing in adopted an anonymous conversation, and `identityProblem` when a token was refused. A signed-in access token expires with the identity token. Identities travel inside the encrypted access token; clients never see the claims ([ADR-0009](adr/0009-visitor-identity.md)).

## Diagnostics

`POST /doctor` serves `npx @boldare/askdare doctor`. It takes a 2-minute token that the CLI encrypts with `CHAT_SECRET` and answers with a report on each bot: whether the server's key, models, vector store and permissions work. The report format is internal and may change in any release.

## Error codes

These codes are stable and safe to branch on in the UI:

| Code | Meaning |
|---|---|
| `invalid_input` | The request was rejected as malformed or too long |
| `unauthorized` | The access token is missing or invalid |
| `session_expired` | The access token expired; refresh it and retry |
| `not_found` | Unknown bot or conversation (also returned for conversations you don't own) |
| `rate_limited` | Too many requests; wait `retryAfterMs` |
| `budget_exceeded` | The bot's daily budget is spent |
| `bot_unavailable` | The bot is disabled (kill switch) or misconfigured |
| `content_blocked` | Reserved for moderation; this version never sends it |
| `timeout` | The turn exceeded the server deadline |
| `upstream_error` | OpenAI failed |
| `internal_error` | Unexpected server error |

## Error keys and parameters

Next to `code` and `message`, an `error` event can carry:

| Field | Meaning |
| --- | --- |
| `retryAfterMs` | How long to wait before retrying, in milliseconds |
| `key` | The [text key](texts.md) for this error, such as `error.messageLength`, so a client can show it in the visitor's language |
| `params` | Values for the placeholders in that text, such as `{ "max": 4000 }` |

`message` is the English text. The widget looks `key` up in the bot's texts, overrides included, fills in `params`, and shows `message` when it has no text for the key.

`key` is absent in two cases:

- **Explained in development.** When `NODE_ENV` is `development`, as under `next dev`, a `bot_unavailable` error caused by the setup carries a description for you in `message` instead of a key: a missing or weak secret, a missing `OPENAI_API_KEY`, a key OpenAI rejects, a model the project can't use. The widget shows that description as it is. In production, the server never sends one.
- **Messages for developers.** Some refusals carry only a plain English `message`, such as `Expected an application/json body.`, `Malformed JSON.`, `Request body is too large.` and `Cross-origin requests are not allowed.`

Error responses outside the stream have the same fields, inside `error`, and a refused form adds `fields` ([Sending a form](#sending-a-form)):

```json
{
  "error": {
    "code": "invalid_input",
    "message": "Messages must be between 1 and 4000 characters.",
    "key": "error.messageLength",
    "params": { "max": 4000 }
  }
}
```

## HTTP status codes

| Status | Code | When |
| --- | --- | --- |
| `200` | | Success. For `POST /messages` and `POST /resume`, the stream has started, and later failures arrive as an `error` event |
| `204` | | `DELETE /conversation` succeeded, also when the conversation was already gone |
| `400` | `invalid_input` | The body is not what the endpoint expects (wrong `Content-Type`, malformed JSON, a JSON body over 256 KB), or the message, file or recording is refused, including when it is too large |
| `401` | `unauthorized` | The `Bearer` token is missing or invalid, or the request is cross-site |
| `401` | `session_expired` | The access token expired; renew it with `POST /session` and retry |
| `404` | `not_found` | An unknown path, bot or asset; a resume token that is invalid or belongs to someone else; a conversation that no longer exists; an answer that can't be resumed; a bot without handoff; a form handle that isn't the visitor's |
| `409` | `invalid_input` | The form was already sent (`POST /forms`, key `error.form.sent`) |
| `429` | `rate_limited` | A rate limit was reached, the conversation reached `maxTurns`, or another dictation is still being transcribed |
| `429` | `budget_exceeded` | A daily token or speech budget is spent |
| `500` | `internal_error` | Unexpected server error |
| `502` | `upstream_error` | OpenAI failed or could not be reached |
| `503` | `bot_unavailable` | The kill switch (`ASKDARE_DISABLED=true`) is on, a secret or `OPENAI_API_KEY` is missing or invalid, or OpenAI refused the key or the model |
| `504` | `timeout` | OpenAI did not answer in time |

An error response with `retryAfterMs` also has a `Retry-After` header, in whole seconds rounded up. For `budget_exceeded`, it lasts until the next midnight UTC.

| Endpoint | Statuses |
| --- | --- |
| `GET /widget.js` | `200` |
| `GET /embed/<bot>`, `GET /theme/<bot>.css`, `GET /assets/<file>` | `200`, `404` |
| `POST /session` | `200`, `400`, `401`, `404`, `429`, `503` |
| `POST /messages` | `200`, `400`, `401`, `404`, `429`, `503` |
| `POST /history` | `200`, `400`, `401`, `404`, `429`, `502`, `503`, `504` |
| `POST /resume` | `200`, `400`, `401`, `404`, `429`, `502`, `503`, `504` |
| `POST /handoff` | `200`, `400`, `401`, `404`, `429`, `503` |
| `POST /forms` | `200`, `400`, `401`, `404`, `409`, `429`, `503` |
| `DELETE /conversation` | `204`, `400`, `401`, `404`, `429`, `502`, `503`, `504` |
| `POST /attachments`, `POST /transcriptions` | `200`, `400`, `401`, `404`, `429`, `502`, `503`, `504` |
| `POST /doctor` | `200`, `401`, `429`, `503` |

Any endpoint can also answer `500`.

## Protocol version

`PROTOCOL_VERSION`, exported from `@boldare/askdare`, is the version of this protocol: `1`. Every event stream (`POST /messages` or `POST /resume` answered with `200`) carries it in the `x-askdare-protocol` response header. Other responses don't have this header.

The widget compares the header with the version it was built with. On a mismatch, it doesn't read the stream and shows `error.updated` ("The assistant was updated. Please reload the page.").

## Client rules

- **Tolerate the unknown.** Ignore unknown event types and unknown fields. Newer servers may add them within the same protocol version.
- **Check the version.** Compare `x-askdare-protocol` with the version the client supports. On a mismatch, show a "please reload" state.
- **Run a watchdog.** If no bytes (events or comments) arrive for 45 s, abort, then [resume the answer](#resuming-an-answer) or re-fetch the conversation history.
- **Resume, don't retry.** A stream that drops mid-answer is resumed with `POST /resume`, never sent again with `POST /messages`, which would start a second turn.
- **Render text safely.** Treat `text.delta` content as untrusted markdown and sanitize it before rendering.

## Versioning

- **Adding** an event type or an optional field is not breaking.
- **Removing or renaming** an event or field, or changing a field's meaning, is breaking. It bumps the protocol version and requires a minor release of `@boldare/askdare` (ADR-0006).
