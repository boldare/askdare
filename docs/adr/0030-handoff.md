# ADR-0030: Handoff to a human

- **Status:** Accepted on 2026-11-27 (task z1), as built by tasks p1, c1, c2, c3 and c4. Decisions 2, 5, 6 and 9 are amended below ("As built in 0.7").
- **Date:** 2026-11-26
- **Related:** [ADR-0031](0031-forms-and-leads.md) (the form a handoff collects contact details with, and falls back to). Built by tasks 0.7-p1 (transports), c1 (protocol), c2 (chat state), c3 (bot and handler) and c4 (UI).

## Context

A support bot that can't reach a person is the first thing buyers hold against it. In hosted products (Intercom Fin, Chatbase) the visitor can ask for a person at any time, the bot can decide to escalate on its own, and outside office hours the chat says so and takes a message with an email address instead. Live chat between an agent and the visitor in the same window is what those products sell on top, and needs an inbox on the other side.

askdare has no inbox and no database ([ADR-0003](0003-conversation-state.md)). It can hand a request to the app at the right moment, as it does with ratings and transcripts ([ADR-0012](0012-server-hooks-and-telemetry.md), [ADR-0016](0016-admin.md)), and the app or its support tool takes it from there. Live agent chat stays with the 0.9 adapters (Slack, HubSpot, Zendesk); 0.7 is a **one-way** handoff: the request reaches a person, who answers outside the chat, usually by email.

The rules that bound the design:
- **[ADR-0004](0004-threat-model.md):** the client never chooses the model, instructions or tools; every endpoint has limits and budgets. A handoff reaches a person, so it is more expensive to abuse than a model call: it costs someone's time.
- **[ADR-0015](0015-reply-options.md) and [ADR-0017](0017-tool-renderers.md):** a button is a visitor message; "buttons that carry an action the server acts on" need their own ADR. This is that ADR, for one action.
- **ADR-0012 and ADR-0016:** hooks carry no message content except `onTranscript`, which is opt-in. Hooks never break a turn, and a failing content hook reports to `onError` by the error's name only.
- **[ADR-0019](0019-compliance-and-guardrails.md):** new controls are opt-in and change nothing for existing bots.
- **[ADR-0022](0022-guardrails-implementation.md):** the server records what it decided in the conversation as fixed developer notes (`[askdare:…]`) that carry no content, so history and the next model call see them.

## Decision

### 1. Turning it on

A bot turns handoff on in `defineBot`; the app says where requests go in `createChatHandler`. Both are needed: a bot with `handoff` and a handler without `onHandoff` fails at startup, and `askdare doctor` reports it.

```ts
defineBot({
  // …
  handoff: {
    model: true,          // the model may call the `handoff` tool (default true)
    button: true,         // the chat shows "Talk to a person" (default true)
    form: 'handoff',      // a form from `forms` (ADR-0031) that collects contact details; optional
    available: () => isOfficeHours(), // optional, default: always available
    content: 'none',      // 'none' | 'summary' | 'transcript' (default 'none')
    limits: { perConversation: 1, perVisitorPerDay: 3, perBotPerDay: 100 },
  },
});

createChatHandler({ bots, onHandoff: webhookHandoff({ url, secret }) });
```

`handoff: true` is a shortcut for the defaults. Without `handoff`, nothing below exists for that bot: no tool, no button, no endpoint answer other than `404`.

### 2. Who triggers it: both, each switchable

- **The model, through a reserved tool `handoff`.** Its strict schema is `{ reason }`, where `reason` is an enum: `visitor_asked`, `cannot_help`, `complaint`, `sensitive`, `sales`. With `content: 'summary'` the schema also has `summary: string | null`, a short note for the person (the docs ask for at most 500 characters; the server cuts longer ones). An enum is what the function-calling guide recommends for a closed choice, and askdare can count reasons without reading text. `defineBot` rejects a bot tool named `handoff`, as it does `suggest_replies`.
  - The tool is offered through `allowed_tools` like the others, so the tool list and the prompt cache stay the same. It is **not offered** once the conversation has reached `perConversation`, while the bot is unavailable and has no fallback, or on the turn's last step (function tools never are, ADR-0015).
  - The model never chooses where the request goes, who receives it or what it contains beyond the reason and the optional summary.
- **The visitor, through a button.** A "Talk to a person" control in the chat header's menu (a headless primitive `HandoffButton`, part `handoff`, plus the default look in the skin). It calls a new endpoint, `POST /handoff`, which runs the same steps as the tool with `reason: 'visitor_asked'` and `trigger: 'visitor'`, and runs no model call.
  - **Why a button with its own endpoint, against ADR-0015's "a click is a message":** a visitor who wants a person must not depend on the model agreeing, and a request typed as a message costs a model call and can be talked out of. The action is one the bot owner turned on, takes no parameters the server acts on, selects no model, tool or instruction, and goes through its own limits (point 7). It is the only exception; ADR-0015 holds for everything else.
  - The button is shown once a conversation exists (after the first answer), so every handoff belongs to a conversation and the server can record it there.

### 3. The steps of a handoff

The same for both triggers:

1. **Limits** (point 7). Over a limit, the handoff ends as `limited`; nothing is sent.
2. **Availability.** `available({ bot, locale, identity })`, if set, may be async and has two seconds. It is the app's office hours, holidays or on-call check. A throw or a timeout counts as unavailable.
3. **Contact details, if the bot has a `form`.** The chat shows the form (ADR-0031) and the handoff waits for its submission, in a later request. The form is skipped for a signed-in visitor whose identity has an email ([ADR-0009](0009-visitor-identity.md)); that email is the reply address. When the bot is unavailable, the same form is shown as a message to leave (ADR-0031's `purpose: 'message'`, texts in point 6), so a visitor fills in one form either way.
4. **Delivery.** `onHandoff(report)` is called and **awaited**, with a deadline of ten seconds, unlike the other hooks (which run after the response). Its outcome decides what the visitor sees, so it can't run after the fact. A throw or the deadline counts as a failure, reported to `onError` as `internal_error` with the error's class name only, as for `onTranscript`.
5. **The outcome, recorded.** The server appends a fixed developer note to the conversation, `[askdare:handoff] <state>` with a fixed sentence per state (no content), as ADR-0022 does for checked answers. The next model call reads it, so the model knows a person was asked and doesn't offer it again; history reads it to show the state after a reload.

The states are:
- `requested`: shown as "Connecting you…" while steps 2 to 4 run, or while the form waits;
- `sent`: `onHandoff` succeeded;
- `saved`: the form's values went to `onLead` instead (ADR-0031), because nobody was available or the delivery failed;
- `unavailable`: nobody was available and there was no form to leave a message in;
- `failed`: the delivery failed and nothing saved the request;
- `limited`: a limit of point 7 refused it.

### 4. What `onHandoff` gets

`onHandoff: (report: ChatHandoffReport) => void | Promise<void>`. The report:
- `id`: a random ID for this handoff, the same on every retry, for the receiver to drop duplicates;
- `bot`, `locale`, `createdAt` (epoch milliseconds);
- `trigger`: `model` or `visitor`; `reason` (the enum above);
- `visitor`: the pseudonym (HMAC) `onUsage`, `onFeedback` and `onTranscript` get;
- `identity`: the verified signed-in user, if any (ADR-0009);
- `conversationId`: the raw ID in the conversation store, as `onFeedback` gets it, so the app's code can fetch the conversation. It never reaches the client;
- `available`: `true`, or `false` for a message left while nobody was available, which reaches `onHandoff` only when the app set no `onLead` (ADR-0031 sends those to `onLead` first), so it still reaches a person, later;
- `contact`: the validated values of the handoff form, when there was one (ADR-0031's `values`), or `{ email }` from the identity;
- content, only as the bot's `content` option allows:
  - `'none'` (the default): nothing from the conversation;
  - `'summary'`: the model's `summary` (absent for a visitor's button);
  - `'transcript'`: the summary, and the visible messages of the conversation's latest history page (the same text `POST /history` shows, after output checks), at most 50 messages and 64 KB, oldest cut first.

Contact details are in every report: the visitor typed them for this purpose, next to a consent box where the bot wants one (ADR-0031). Message content follows the rule of ADR-0016: only when the app opts in. `docs/privacy.md` lists the report and what each `content` level adds.

**Throwing is how a transport says it failed.** There is no return value to interpret, and a transport that only logs "unavailable" should use `available` instead.

### 5. Transports in 0.7: a webhook and email, as functions

A transport is any function of the `onHandoff` type; askdare ships two factories in the core, in a `handoff/` module with no new dependency. Apps combine them in their own function (send an email *and* post a webhook) or write their own.

- **`webhookHandoff({ url, secret, timeoutMs?, headers? })`** posts the report as JSON.
  - **Signed with [Standard Webhooks](https://www.standardwebhooks.com/)** (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256>`), so receivers can use an existing verifier. `secret` is the app's own (`whsec_…`), never derived from `CHAT_SECRET`, since the receiver has to hold it.
  - **`https:` only** (and `http://localhost` in development); redirects are not followed.
  - **Timeout and retries:** each attempt has `timeoutMs` (default 4 seconds); a network error, a `408`, `429` or `5xx` gets one retry after 500 ms, inside the ten-second deadline of point 3. A `2xx` is success; anything else is a failure. There is no queue and no retry after the response, since there is no database to keep one in; the receiver dedupes by `webhook-id`, which is the report's `id`.
- **`emailHandoff({ to, from, send })`** formats the report as a plain-text email and passes it to the app's `send({ to, from, replyTo, subject, text })` function, which wraps whatever the app already sends mail with (Resend, Postmark, SES, nodemailer).
  - `replyTo` is the visitor's email from the form or the identity, so the person answers the visitor directly. That is the "one-way" handoff.
  - The subject is fixed text plus the bot and the reason; nothing the visitor typed goes into a header. Line breaks are removed from every header value as a second guard.
  - askdare writes no HTML email: plain text can't carry a hidden link or a tracking pixel from the conversation.

### 6. What the visitor sees

- **Connecting:** a status line under the answer (or under the button's request) with a spinner, `handoff.connecting` ("Connecting you with a person…"), announced once to screen readers.
- **Sent:** `handoff.sent` ("Done. A person from our team will get back to you by email."). With a reply address, `handoff.sentTo` names it ("…at anna@example.com").
- **Unavailable:** with a form, the form titled `handoff.unavailableTitle` ("Nobody is available right now. Leave a message and we'll reply by email."), and once it is sent, `handoff.saved`; without a form, the message `handoff.unavailable`.
- **Saved:** `handoff.saved` ("We've saved your message. A person will reply by email.").
- **Failed:** `handoff.failed` ("We couldn't reach the team right now. Please try again later."). A delivery that fails after a form was sent goes to `onLead` first (ADR-0031) and shows as saved; only when that fails too, or there was no form, the visitor sees this.
- **Limited:** `handoff.limited` ("You've already asked for a person. They'll get back to you.").

All are texts in the bot's dictionary, per language ([ADR-0014](0014-runtime-language.md)); the state is shown in plain text, never Markdown. When the model triggered the handoff, it writes its own answer around the status, after the tool's output told it the state.

### 7. Limits and abuse

Every handoff reaches a person, so it has its own budget, in the existing rate-limit store (in memory, or Upstash):
- `perConversation` (default 1): a second request in the same conversation ends as `limited`;
- `perVisitorPerDay` (default 3), keyed by the visitor or signed-in user, and the same per IP (grouped by /64 for IPv6);
- `perBotPerDay` (default 100): when it runs out, `onError` gets one report a day, as for token budgets (ADR-0004), and the bot reports `limited` until the next day.

A request is counted when it is accepted, before delivery, and a failed delivery stays counted. The human check (ADR-0019) applies at session creation as for every request. `POST /handoff` has the same-origin and access-token checks every endpoint has, and the visitor's resume token must own the conversation.

### 8. The conversation after a handoff

**The bot keeps answering.** In a one-way handoff the person answers outside the chat, so closing the chat would leave the visitor with nothing until then. The developer note tells the model a person was asked, and the instructions the docs suggest say what to say about it. A setting to stop the bot after a handoff waits for live chat in 0.9, where it means "a person is now writing here".

### 9. Protocol (additive in version 1)

- **A new event `handoff { messageId, state }`** in the turn's stream when the model called the tool: `requested` as soon as the call is seen, then the final state once the step's calls are done, before the model writes on. `messageId` is the answer it belongs to. When a form is needed, the `form` event of ADR-0031 follows `requested`, and the final state comes from the form's submission.
- **`POST /handoff { botId, resumeToken }`** with the access token answers `200` with `{ state, form? }`: `state` is the final state, or `requested` with `form` (the form's handle and name, ADR-0031) when the visitor has to fill it in. `404` for a bot without handoff. A handoff limit is the state `limited`, which the chat shows, not a `429`; the endpoint's own burst limit (requests per visitor per minute) still answers `429`.
- **`POST /forms`** (ADR-0031) answers a handoff form with `{ handoff: state }`, the final state.
- **History:** a message gets an optional `handoff: { state }` rebuilt from the developer note, on the answer of the turn the note follows (for a button, on the latest answer at that time).
- Older clients ignore the event and the field; an old widget simply has no button.

## As built in 0.7

Amended on 2026-11-27 (task z1), where the code differs from the decision above:
- **Decision 2, the button:** a headset icon button in the chat header's actions, named by `handoff.button` ("Talk to a person"), not an item in a menu: the header has no menu. `HandoffButton` renders only when the public configuration has `handoff: true`, which the server sets when the bot's `handoff.button` is on, and once there is an answer. A second primitive, `HandoffStatus` (part `handoff-status`, `data-state`, `role="status"`), shows the state under the answer.
- **Decision 2, the tool while nobody is available:** the `handoff` tool stays offered while the bot is unavailable. `available()` has two seconds and isn't called before every turn, so the model hears `unavailable` from the tool's output instead. `docs/handoff.md` says so.
- **Decision 3, step 3:** the form is skipped for a signed-in visitor with an email only while the bot is available. When nobody is, the form is shown as a message to leave, signed in or not.
- **Decision 3, step 5, the notes:** a handoff the model started keeps its state in the `handoff` call's output; there is no separate note. The button and every form submission append a note (`[askdare:handoff] <state>`, with the form's call ID when there is one).
- **Decision 5, where the transports live:** `webhookHandoff`, `emailHandoff` and their types are exported from `@boldare/askdare/next`, next to `ChatHandoffReport` and the other reports. A transport throws `HandoffDeliveryError` (internal) or whatever the app's `send` threw.
- **Decision 6, a message left through the handoff's form:** its `onLead` is awaited, with the same ten seconds as `onHandoff`, since its outcome (`saved` or `failed`) is what the visitor sees. A model form's `onLead` still runs after the response (ADR-0031).
- **Decision 9, the protocol:** `POST /handoff`'s `form` and history's `forms[]` also carry `purpose` (`handoff` or `message`), so the chat picks the right title after a click or a reload. The chat state has the `handoff()` action; it emits no browser event for a handoff (78 bytes the headless budget didn't have).
- **Known limits:** a note appended by `POST /handoff` while a turn on an item store is running can make that turn's next append conflict, which the visitor sees as "conversation busy". `ROADMAP.md` lists it.

## Consequences

- **New public API (ADR-0006, listed by task z1):** `handoff` in `defineBot` and its option types; `onHandoff` in `createChatHandler`, `ChatHandoffReport`; `webhookHandoff` and `emailHandoff`; the reserved tool name `handoff`; the `handoff` event, the `POST /handoff` endpoint and the `handoff` history field; the `HandoffButton` primitive and its part; the `handoff.*` texts.
- **`onHandoff` is the first awaited hook.** A slow transport delays the visitor's "sent", bounded by ten seconds. ADR-0012's "hooks never break a turn" still holds: a failing transport ends in a state the chat shows, never in a failed turn.
- **No delivery guarantee beyond the request.** A receiver that is down for longer than the retry gets nothing, and the visitor is told; the message is saved through `onLead` when the app set it. A queue would need storage; apps that need one put it behind their own `onHandoff`.
- **Duplicates are possible** (an attempt that timed out but arrived, then a retry). The `id` lets the receiver drop them.
- **Contact details and, when opted in, conversation content leave the chat** for the app's receiver or mailbox. The privacy page and the app's notice must say so; askdare stores none of it.
- **The conversation holds one more kind of developer note,** with no content, so it adds a few tokens to later turns.
- **The `handoff` tool costs input tokens on every step** of a bot that turns it on, inside the cached prefix, as `suggest_replies` does. `docs/costs.md` says so.

## Settled with the maintainer (2026-11-26)

The questions left open in the first draft, all settled as recommended:
- **Email:** an app-supplied `send` function only; no built-in provider adapter in 0.7.
- **Defaults:** `perConversation: 1`, `perVisitorPerDay: 3`, `perBotPerDay: 100`, and `content: 'none'` for every transport.
- **The button's place:** in the chat header's menu.
- **The reason enum:** the five fixed values above, not a bot-defined list.

## Alternatives considered

- **Only the model triggers it.** The cheapest to build, but a visitor who asks for a person can be refused by a model that thinks it can help, which is the complaint buyers bring from other bots.
- **Only a button.** Misses the cases the visitor doesn't name: a complaint, a question the knowledge base can't answer, a sensitive topic.
- **The button sends a message ("Talk to a person") and the model calls the tool** (ADR-0015 as it stands). Keeps one path, but puts a model call and the model's judgement between the visitor and a person.
- **`onHandoff` after the response, like the other hooks.** The visitor would always see "sent", even when nothing arrived.
- **Built-in SMTP, or vendor adapters (Resend, Postmark) in the core.** SMTP in the core means TLS, authentication and deliverability problems askdare can't test for every host; vendor SDKs are dependencies the core doesn't take (ADR-0001). A function the app supplies costs one line with any provider. Ready-made adapters can come as small add-ons later if people ask.
- **A transport interface (`{ send, available }` object) instead of a function.** Availability is a property of the bot (office hours), not of where requests go, and a plain function composes with no wrapper.
- **A retry queue in Upstash.** It would make handoff the first feature that needs a shared store to work at all; the receiver's own queue is the better place.
- **Closing the chat for the bot after a handoff.** Right for live chat (0.9), wrong for email, where the answer can take hours.
- **The model writes the whole request (free-text reason, the visitor's details).** Contact details copied by the model can be wrong or injected; they come from the form, validated (ADR-0031).
- **A handoff as a `tool.ui` card.** Cards render only with the site's `toolRenderers` and not in the script-tag widget (ADR-0017), and the state has to come from the server, not from a tool's result.
