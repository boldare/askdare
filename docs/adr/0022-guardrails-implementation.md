# ADR-0022: How guardrails check messages and stream answers

- **Status:** Accepted
- **Date:** 2026-11-21
- **Extends:** [ADR-0019](0019-compliance-and-guardrails.md), decision 2, which left the streaming policy to task 0.5-3. ADR-0019 stays as written.

## Context

ADR-0019 decided that moderation and the `onInput`/`onOutput` hooks are server-side and opt-in. It left two things to the implementation:
- whether output checks hold an answer back or retract a blocked one;
- which OpenAI mechanism runs moderation.

OpenAI offers two mechanisms ([moderation guide](https://developers.openai.com/api/docs/guides/moderation), checked 2026-11-21):
- **A `moderation` parameter on `responses.create`:**
  - the model still generates normally;
  - while streaming, the scores arrive only after the whole output;
  - what its `block` mode does is not documented.
- **The moderation endpoint (`POST /v1/moderations`):** free, and it checks any text you send it.

With `store: true`, a turn is written to the OpenAI conversation as it runs.

## Decision

1. **Moderation calls the moderation endpoint**, not the inline parameter.
   - Input is checked before the model reads it and before the conversation stores it.
   - Output is checked once, as the whole answer across every tool step.
   - The model comes from `moderation.model` in the bot's config.
2. **Order:** the hook runs first, then moderation checks the text after any redaction. A first message that is blocked leaves no conversation behind.
3. **Fail open:** a hook that throws or returns a malformed verdict, and a moderation call that fails, let the message through. Each failure logs one line with no content, as ADR-0012 asks of every hook.
4. **Hold back, never retract.**
   - While output checks are on, the server holds the answer's text, citations and tool cards until the turn is complete and checked. Reasoning and tool status still stream.
   - Allow sends the held events in order. Redact sends the replacement text with the citations, and drops the answer's tool cards, reply options and rating handle: `onOutput` sees only the text, so nothing it didn't check goes out with the replacement. Block ends with `content_blocked`, and the answer never reaches the browser.
   - This applies only to bots that turn output checks on.
5. **Stored history fails closed for bots with output checks.** OpenAI stores every answer while it streams, before it is checked, so `/history` could otherwise show it during the check, after a check that timed out, or after a tool step that failed.
   - After the check, askdare appends one fixed developer note without content: `[askdare:allowed]`, `[askdare:withheld]` or `[askdare:replaced]`. A replacement is stored after its note as an **assistant** message, so text derived from model output never gains developer authority.
   - For these bots, history shows an answer only when a note settles it: allowed answers as they were, the replacement instead of a replaced answer, nothing for a withheld one. Answers no note settled stay hidden, including the latest turn while it is checked. A replaced or withheld turn shows no tool cards or reply options.
   - Only developer items count as notes, and only with their exact fixed text, so neither visitors nor the model can forge one.
   - Bots without output checks write no notes and read history exactly as before (withheld and replaced notes left by an earlier configuration still apply).
6. **One turn at a time per conversation, for bots with output checks.** Each note settles the answers before it in its turn, so two concurrent turns on one conversation could settle each other's answers. A turn takes a hold on its conversation in the rate-limit store (key per conversation, window `turnTimeoutMs` plus a minute so a dead process can't keep it) before it starts, or right after creating a new conversation and before its handle leaves the server. A second turn gets `rate_limited` with the existing `error.rate_limited` text. The hold is released when the turn ends.
7. **`toolResults: 'untrusted'`** wraps successful tool results as `{"untrusted_tool_result": …}` and adds one rule to the instructions of bots with tools. History unwraps them. File search results are not wrapped.

## Consequences

- With output checks on, the visitor sees the answer all at once at the end of the turn instead of streamed. `docs/guardrails.md` says so.
- Each checked answer costs one more `conversations.items.create` call, written while the answer is sent.
- The original of a withheld answer stays in the OpenAI conversation until the conversation is deleted. If the note can't be written, a reload hides the answer, even one the visitor saw; the failure is logged.
- Conversations that existed before a bot turned output checks on show none of their earlier answers in the history.
- A visitor who stops an answer, or a second tab, waits for the running turn to end before sending again. With the in-memory store the hold is per instance, like every limit.
- An outage of the moderation endpoint lets messages through. A fail-closed option can be added later without breaking anything.
- Not yet verified live: that `conversations.items.create` accepts a developer message and that the model reads it on later turns. The SDK types allow it, and the daily live smoke test should cover it.

## Alternatives considered

- **The inline `moderation` parameter:** it checks too late for input, and its blocking behaviour is undocumented.
- **Retracting a blocked answer in the browser:** the visitor would already have read it.
- **Deleting the stored items of a withheld answer:** it risks leaving orphaned reasoning items, and can't be verified without live calls.
- **Notes only for withheld or replaced answers (fail open):** an answer still being checked, or whose check never finished, would show in the history.
- **The replacement inside the developer note:** model-derived text would gain developer authority on later turns.
- **Passing cards and reply options to `onOutput`:** a larger hook contract for little gain; dropping them on redact is simpler and safe.
