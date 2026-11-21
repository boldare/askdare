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
   - Allow sends the held events in order. Redact sends the replacement text. Block ends with `content_blocked`, and the answer never reaches the browser.
   - This applies only to bots that turn output checks on.
5. **Stored history:** OpenAI has already stored a blocked or redacted answer by the time it is checked.
   - askdare appends a developer-role note to the conversation (`[askdare:withheld]` or `[askdare:replaced]` plus the replacement).
   - History hides the withheld answer or shows the replacement, and the model reads the note on its next turn.
   - Only developer items count, so visitors can't forge a note.
6. **`toolResults: 'untrusted'`** wraps successful tool results as `{"untrusted_tool_result": …}` and adds one rule to the instructions of bots with tools. History unwraps them. File search results are not wrapped.

## Consequences

- With output checks on, the visitor sees the answer all at once at the end of the turn instead of streamed. `docs/guardrails.md` says so.
- The original of a withheld answer stays in the OpenAI conversation until the conversation is deleted. If the note can't be written, a reload shows the original. That failure is logged, best effort.
- An outage of the moderation endpoint lets messages through. A fail-closed option can be added later without breaking anything.
- Not yet verified live: that `conversations.items.create` accepts a developer message and that the model reads it on later turns. The SDK types allow it, and the daily live smoke test should cover it.

## Alternatives considered

- **The inline `moderation` parameter:** it checks too late for input, and its blocking behaviour is undocumented.
- **Retracting a blocked answer in the browser:** the visitor would already have read it.
- **Deleting the stored items of a withheld answer:** it risks leaving orphaned reasoning items, and can't be verified without live calls.
