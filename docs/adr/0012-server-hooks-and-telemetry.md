# ADR-0012: Server hooks for usage and feedback, and an OpenTelemetry add-on

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Site owners ask three things once a chat is live: what each conversation costs, where a slow answer spent its time, and whether the answers help. askdare has no database (ADR-0003) and logs no message content (ADR-0004), so it can't keep that data itself. It can hand it to the app at the right moment.

Inside the server, the turn already reports its token usage, but only to settle budgets, and only three counters: input, cached input and output. A failed turn reports nothing. `onError` is the one public hook, and an exception thrown in it reaches the request.

Answers have no stable reference a visitor could rate. While a message streams, the client sees a random local ID. After a reload, it sees the OpenAI item ID, and a raw ID from the client can't be trusted (ADR-0004: the client never chooses IDs).

## Decision

### `onUsage`

`createChatHandler({ onUsage })` is called once per turn, after the turn ends, including turns that fail or are stopped. It receives a report with:
- `bot`, and the `model` the response reports (the configured model if there was no response);
- `conversation` and `visitor` as pseudonyms (HMACs). `visitor` is the HMAC of the signed-in user's ID when there is one, the same value as the OpenAI `safety_identifier`;
- `startedAt` (epoch milliseconds) and `durationMs`;
- `outcome` (`completed`, `stopped` or `failed`), the `finishReason`, and the `errorCode` when it failed;
- `usage`, summed over every model call in the turn: `inputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `outputTokens` and `reasoningTokens`;
- `steps`, the number of model calls;
- `tools`: for each function call, its `name`, `startedAt`, `durationMs` and `outcome` (`ok`, `error` or `timeout`).

The report never contains message text, tool arguments or results, file names, IP addresses or raw IDs.

A turn that fails mid-stream reports the usage askdare saw, which can be less than what OpenAI bills.

### `onFeedback`

- **Every answer gets a feedback handle.** It's an encrypted token like the others (ADR-0004), bound to the bot and the visitor (or the signed-in user), carrying the conversation and the OpenAI item ID. It comes on `message.end` and on each answer in the history.
- **The visitor rates an answer** with `POST /feedback { feedback, rating: 'up' | 'down' | null, comment? }`:
  - `null` takes the rating back;
  - `comment` holds at most 500 characters;
  - the request needs the access token, and the handle must belong to its visitor or user, like a conversation does;
  - it has its own rate limit.
- **The app gets it through `createChatHandler({ onFeedback })`.** The hook receives:
  - `bot`, `rating` and `comment`;
  - `visitor`, a pseudonym;
  - the verified `identity`, if any;
  - the raw `conversationId` and `itemId`, so the app's own code can fetch the conversation for review. Neither ever reaches the client.
- **The buttons show only when there is somewhere to send a rating:** when `onFeedback` is set and the bot doesn't turn them off with `widget.feedback: false`.
- **askdare doesn't store ratings.** The widget remembers the visitor's own rating in its storage.

### Hooks never break a turn

- `onUsage`, `onFeedback` and the existing `onError` may be async.
- askdare calls them after the response has ended (`waitUntil`), catches anything they throw, and logs one line naming the hook, without details. A hook can't delay, change or fail the chat.

### OpenTelemetry is an add-on

- **The package is `@boldare/askdare-otel`, with a peer `@opentelemetry/api`.** Its `otelUsage({ tracer? })` returns an `onUsage` function.
- **It turns each report into spans after the fact,** with explicit start and end times:
  - `chat <model>` for the turn;
  - a child `execute_tool <name>` for each tool call.
- **The attributes follow the OpenTelemetry GenAI semantic conventions:** `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model` and `gen_ai.response.model`, `gen_ai.usage.*`, `gen_ai.response.finish_reasons` and `error.type`.
- **The conventions are still in Development status,** so the add-on changes the names it emits only in a minor release, with a changelog note.
- **The core doesn't depend on OpenTelemetry.**

## Consequences

- **New public API (ADR-0006):**
  - the `onUsage` and `onFeedback` options and their report types;
  - the `feedback` fields in the protocol and the `/feedback` endpoint, both additive in protocol version 1;
  - the `widget.feedback` option;
  - the add-on.
- Cost tracking, dashboards and alerts are the app's job, with data it can trust: pseudonyms that don't change between turns (until `CHAT_SECRET` rotates), and counters straight from OpenAI.
- A rating can't be forged for another visitor's answer, another bot or another conversation.
- A comment is text the visitor typed, handed to the app's hook. The app's privacy notice has to cover it, and `docs/privacy.md` says so.
- Spans start in whatever trace context is active when the hook runs. With Next's instrumentation that is the request's trace; otherwise they are new traces.

## Alternatives considered

- **OpenTelemetry in the core**, as an optional peer loaded on demand. Bundlers warn about the missing import, and the core would move with every change to the conventions.
- **A structural `tracer` option in the core.** No dependency, but the attribute mapping would still live in the core.
- **Ratings in OpenAI conversation metadata.** That's per conversation rather than per answer, holds 16 keys, and the site owner couldn't query it.
- **Rating by the OpenAI item ID sent from the client.** The client could rate any item in the project. The signed handle prevents that.
- **Message text in `onUsage`.** Telemetry often goes to third parties, and ADR-0004 keeps content out of logs.
