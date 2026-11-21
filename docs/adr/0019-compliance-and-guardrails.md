# ADR-0019: Compliance by default, guardrails and bot protection

- **Status:** Proposed
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

1. **The AI disclosure is part of every supported way to build the chat.**
   - A `Disclosure` primitive joins `@boldare/askdare/react`, and the skin uses it.
   - In development, `Root` warns once if the chat rendered without it while `disclosure` isn't `false`.
   - `askdare doctor` reports `disclosure: false` as a warning that names art. 50.
   - Turning it off stays possible, because the host page may already say so, but never silently.
2. **Guardrails are server-side, opt-in and isolated like every other hook (ADR-0012).**
   - `moderation` in `defineBot` runs OpenAI moderation on input, output or both. It is off by default, because it adds latency and cost.
   - `onInput` and `onOutput` hooks return allow, block (with a text for the visitor) or a redacted message.
   - A blocked turn ends with `content_blocked`.
   - Nothing blocked or redacted is logged as content.
   - For output, the hook sees the finished answer. Whether the stream holds answers back while output checks are on, or retracts a blocked one, is settled in the task with a recorded-stream test, and documented.
3. **Tool results reach the model marked as untrusted data,** inside a wrapper the instructions refer to, so text inside a tool result isn't followed as instructions.
4. **The `HumanVerifier` port is built,** with a Cloudflare Turnstile adapter, checked only when a session is created, as ADR-0004 described. The iframe's CSP is widened only for bots that configure a verifier. The loader doesn't change.
5. **In-memory rate limits fail closed in production.** The handler refuses to start with the in-memory store when `NODE_ENV` is `production`, unless the operator sets a shared store or explicitly opts in (for single-instance hosts). The option's name is settled in the task.
6. **Accessibility target:** the widget and the default skin target WCAG 2.2 AA, with a dated conformance statement in `docs/accessibility.md`. Finished answers are announced once to screen readers.

## Consequences

- A team deploying askdare gets a disclosure, a conformance statement and a compliance guide without custom work.
- `defineBot` and the public API grow: `moderation`, `onInput`, `onOutput`, a verifier option, and the `Disclosure` primitive. Each is listed in ADR-0006's surface through the 0.5 snapshot.
- Fail-closed limits are a breaking change for production deployments on the in-memory store. The changeset names the one-line fix.
- Moderation adds a model call per checked message. `docs/costs.md` has to say so.
- askdare doesn't certify legal compliance. The docs give the means and say which decisions stay with the operator.

## Alternatives considered

- **Leave compliance to each app:** that is the situation today. It works for experts and fails silently for everyone else, and it gives up one of the most concrete reasons to choose askdare.
- **Moderation on by default:** safer, but it adds cost and latency to every turn and can refuse harmless questions. We prefer an explicit choice, made visible in `doctor` and `docs/going-public.md`.
- **Client-side guardrails:** the client is untrusted (ADR-0004), so a guard there can always be bypassed.
- **Keep deferring Turnstile:** limits alone don't stop distributed abuse of a public chat, and a client with a public site will ask for a human check.
