# ADR-0019: Compliance by default, guardrails and bot protection

- **Status:** Accepted (2026-11-21)
- **Date:** 2026-11-21
- **Extends:** [ADR-0004](0004-threat-model.md) (threat model). ADR-0004 stays as written; this ADR adds controls to it and takes up the `HumanVerifier` it deferred.

## Context

In 2026, a website chatbot is bought against three external requirements:
- **AI Act, art. 50(1).** Since 2026-08-02, people must be told they are interacting with an AI system, unless it is obvious. The transparency duties were not postponed by the Digital Omnibus, which moved the high-risk rules to December 2027.
- **European Accessibility Act.** In force since June 2025. EN 301 549 V4.1.1 (September 2026) moves to WCAG 2.2 AA.
- **Content safety.** A public, anonymous chat can be pushed to produce harmful or off-brand answers. Tool results are a prompt-injection path.

What askdare does today:
- The skin shows an AI disclosure by default (`widget.disclosure`, `false` hides it). The headless primitives (ADR-0011) and `embedPath` (ADR-0018) don't include it, so a custom UI can drop it without noticing.
- There is no moderation pass and no hook to block or redact input or output. `content_blocked` exists only as an error code for OpenAI's own refusals.
- Tool results go back to the model as plain content.
- The `HumanVerifier` (Turnstile) was deferred in ADR-0004 on 2026-10-29: limits and budgets first, and Cloudflare's script loosens the iframe's CSP.
- In-memory rate limits only warn in production. On serverless or multi-instance hosts that makes every limit per instance.

Hosted competitors (Intercom Fin, Chatbase) and toolkits (AI SDK, assistant-ui) don't offer this compliance as a default. It is the cheapest thing that sets askdare apart, and it needs no new infrastructure.

## Decision

**Principle: everything is configurable, and nothing restricts an existing setup.**
- Each control below is an option.
- Upgrading to 0.5 changes nothing for a bot that doesn't turn a new option on.
- Defaults keep today's behaviour.
- askdare informs (docs, `doctor`, development warnings that can be silenced) but never blocks a visitor or refuses to start unless the operator turned on an option that does.

1. **The AI disclosure is available on every supported way to build the chat.**
   - A `Disclosure` primitive joins `@boldare/askdare/react`, and the skin uses it.
   - `widget.disclosure` keeps working as today: shown by default in the skin, with `false` to hide it and `privacyUrl` to link a notice. Its text can be replaced per language like any other text.
   - In development, `Root` notes once in the console if the chat rendered without a `Disclosure` while `disclosure` isn't `false`. Setting `disclosure: false`, or rendering your own notice, silences it.
   - `askdare doctor` mentions `disclosure: false` as information, not a failure.
2. **Guardrails are server-side, opt-in and isolated like every other hook (ADR-0012).**
   - `moderation` in `defineBot` runs OpenAI moderation on input, output or both. It is off by default. Which categories block, and what the visitor sees, are options.
   - `onInput` and `onOutput` hooks, when set, return allow, block (with a text for the visitor) or a redacted message. With no hook, every message passes as today.
   - A blocked turn ends with `content_blocked`. Nothing blocked or redacted is logged as content.
   - For output, the hook sees the finished answer. While output checks are on, the server holds the answer's text, citations and cards back until the turn is complete and checked; progress still streams. A blocked answer never reaches the browser, so nothing is retracted (settled in task 0.5-3 with a recorded-stream test; [Guardrails](../guardrails.md#streaming-while-answers-are-checked)). It only applies to bots that turn output checks on.
   - Moderation uses OpenAI's moderation endpoint, not the `moderation` parameter of `responses.create`: input must be checked before the model sees it and the conversation stores it, and output across every step of a turn. A failed check, like a failing hook, lets the message through.
3. **Marking tool results as untrusted is an option,** `toolResults: 'untrusted'` in `defineBot`, off by default.
   - When on, results reach the model inside a wrapper the instructions refer to, so text inside a tool result isn't followed as instructions.
   - The docs recommend it for tools that return third-party text.
4. **The `HumanVerifier` port is built and optional,** with a Cloudflare Turnstile adapter.
   - It is checked only when a session is created, as ADR-0004 described.
   - Bots without a verifier work exactly as today.
   - The iframe's CSP is widened only for bots that configure one. The loader doesn't change.
5. **In-memory rate limits keep working in production.** The existing warning stays. An opt-in `limits.requireSharedStore: true` makes the handler refuse to start without a shared store, for teams that want that guarantee. The option's final name is settled in the task.
6. **Accessibility target:** the widget and the default skin target WCAG 2.2 AA, with a dated conformance statement in `docs/accessibility.md`. Finished answers are announced once to screen readers. This changes no option and restricts nothing.

## Consequences

- A team deploying askdare gets a disclosure, a conformance statement and a compliance guide without custom work, and turns on the stricter controls it needs.
- The public API grows: `defineBot` gets `moderation`, `onInput`, `onOutput`, `toolResults` and a verifier option, `limits` gets `requireSharedStore`, and the React entry gets the `Disclosure` primitive. Each is listed in ADR-0006's surface through the 0.5 snapshot.
- None of this is a breaking change. A minor changeset per feature is enough.
- Moderation, when on, adds a model call per checked message. `docs/costs.md` has to say so.
- Secure-by-default is weaker than it could be: a public bot without a shared store, verifier or moderation still runs. `docs/going-public.md` and `doctor` point to each option instead.
- askdare doesn't certify legal compliance. The docs give the means and say which decisions stay with the operator.

## Alternatives considered

- **Leave compliance to each app:** that is the situation today. It works for experts and fails silently for everyone else, and it gives up one of the most concrete reasons to choose askdare.
- **Strict defaults** (moderation, untrusted tool results and a required shared store, all on): safer for a careless deployment, but they add cost and latency, can refuse harmless questions and break working setups on upgrade. We prefer explicit choices, made visible in `doctor` and `docs/going-public.md`.
- **Client-side guardrails:** the client is untrusted (ADR-0004), so a guard there can always be bypassed.
- **Keep deferring Turnstile:** limits alone don't stop distributed abuse of a public chat, and a client with a public site will ask for a human check.
