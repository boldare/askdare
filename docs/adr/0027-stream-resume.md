# ADR-0027: Resuming an answer after a dropped connection

- **Status:** Proposed
- **Date:** 2026-11-23
- **Evidence:** spike S7, question 6 and probe p5 ([findings](../../spikes/s7-store/FINDINGS.md)).

## Context

When a visitor's connection drops in the middle of an answer (a train tunnel, a phone switching networks, a proxy timeout), the chat shows an error and the rest of the answer is lost to them, although the server finishes it: `stream-turn.ts` runs the model call on the turn's `deadline` signal, not the request's, and the finished answer lands in the conversation. Today the visitor gets it back only by reloading.

S7 asked whether resume belongs in the `ConversationStore` ([ADR-0024](0024-conversation-store.md)). It doesn't: resume needs the protocol events of a running turn for a few minutes, written at the rate of text deltas, with a way to wake a waiting reader. The conversation store keeps model items for months and is written once per step. The OpenAI default, which has no store of ours, needs resume too.

S7's Postgres prototype worked (400 deltas written one by one in 186 ms, or in 20 batched flushes in 12 ms; 150 events read in 2.2 ms; a `LISTEN/NOTIFY` wake-up in 6 ms), but it needs a listening connection per waiting reader, which serverless Postgres poolers handle poorly.

## Decision

1. **A separate port, `TurnEventLog`,** shaped like `RateLimitStore`:
   - `append(turnId, events)`, `read(turnId, afterSeq)` and `wait(turnId, afterSeq, timeoutMs)`, with a time to live of the turn timeout plus a grace period, after which a turn's events are gone;
   - it holds **protocol events only**, numbered per turn, never raw provider events (ADR-0002);
   - the turn writes them in batches (a flush every few events or milliseconds, the exact numbers set by the implementing task), never one write per delta.
2. **Implementations:**
   - `memoryTurnLog()`, the default: bounded in size and time. A reconnect resumes only when it reaches the same instance; otherwise the client falls back to reloading history, which is today's behaviour.
   - `upstashTurnLog({ redis })` in `@boldare/askdare-upstash`, next to the rate-limit store: a Redis stream per turn (`XADD`, `XRANGE`, `EXPIRE`). If the REST client can't block, `wait` polls at a short interval; the task measures which.
   - Postgres (an unlogged table with batched flushes) is not in 0.6. The port lets a site that runs only Postgres add it later.
   - Chosen in `createChatHandler({ resume: { log } })`, on the server only.
3. **Protocol (additive within v1):**
   - Every event frame of `POST /messages` carries an SSE `id:` with its sequence number.
   - A new `POST /resume` takes `{ botId, resumeToken, messageId, after }` and answers an event stream: the events after `after`, then the live ones until `message.end` or `error`. The client reads it with `fetch`, as it does `POST /messages`, so this replaces the `Last-Event-ID` header that `EventSource` would send.
   - The turn is found from the conversation in the visitor's resume token, never from the request alone. A turn of another conversation, or one whose events expired, answers `404` with `not_found`; the client then reloads history.
4. **The client** retries a stream that ends without `message.end` or `error` through `POST /resume` a few times with backoff, then reloads history. Text already shown stays; resumed events continue it without duplicates, since each carries its sequence number.
5. **Keeping the turn alive:** a turn has to keep running after its response closes. The handler already has a `waitUntil` option. The implementing task verifies this on Vercel (`after()` or `waitUntil`) and on Heroku; a platform where it fails gets no resume, and the docs say so.
6. **Privacy:** the log holds answer text for minutes. The implementations log nothing about the values they hold, and `docs/privacy.md` names the log and its time to live.
7. **Public surface** (added to ADR-0006 when this is accepted): the `TurnEventLog` port, `memoryTurnLog`, the `resume` option of `createChatHandler`, `upstashTurnLog`, the turn log suite in `@boldare/askdare/testing`, the `id:` field of event frames and `POST /resume`.

## Consequences

- A dropped connection no longer costs the visitor the answer, on hosts where the turn outlives its response and a shared log is configured.
- Sites on several instances need Upstash (which many already run for rate limits) for resume to work across instances.
- Each turn writes its events a second time, into the log. Batching keeps that to a few writes per turn.
- The client gets a reconnect path that needs tests for duplicates, gaps and expired turns.

## Alternatives considered

- **Resume inside `ConversationStore`:** a different lifetime and write rate, and the OpenAI default would get no resume.
- **Postgres as the main implementation:** a listening connection per waiting reader doesn't suit serverless poolers. It stays possible as a later adapter.
- **Only reloading history after a drop:** that's today. It works only once the turn has finished, and shows nothing in between.
- **Resuming at OpenAI** (a streamed background response, resumed with `starting_after`, per the background mode guide): it exists only on OpenAI, only for responses OpenAI stores, its docs warn of a later first token, and it resumes provider events, which we would still have to map again for the client.
