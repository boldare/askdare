# ADR-0023: The human check as built, and a 33 KB budget for the React entry

- **Status:** Accepted (decision 5, the budget, superseded by [ADR-0028](0028-react-budget-34-kb.md))
- **Date:** 2026-11-21
- **Extends:** [ADR-0019](0019-compliance-and-guardrails.md), decisions 4 and 5. ADR-0019 stays as written.
- **Supersedes in part:** [ADR-0006](0006-support-matrix-and-versioning.md), the size budget of `@boldare/askdare/react` in an app's bundle (32 KB). The rest of ADR-0006 stands.

## Context

ADR-0019 decided on an optional `HumanVerifier` with a Cloudflare Turnstile adapter, and an opt-in `limits.requireSharedStore`. It left the names and the details to task 0.5-4.

The challenge has to render inside the chat, because the loader has about 100 bytes of its 5 KB budget left. That means a `HumanCheck` primitive in `@boldare/askdare/react`, at about 400 bytes gzipped. The entry was at 32,457 of its 32,768 bytes.

## Decision

1. **Public surface** (added to the list in ADR-0006):
   - `security.humanVerifier` in `defineBot`;
   - the `HumanVerifier` port, with `HumanChallenge` and `HumanCheckContext`;
   - the `turnstile({ siteKey, secretKey?, hostnames? })` adapter and its `TurnstileOptions` type;
   - the `TURNSTILE_SECRET_KEY` variable;
   - `limits.requireSharedStore` in `createChatHandler`;
   - the `HumanCheck` primitive and its part `human-check`;
   - `ChatConfig.humanCheck` with its `ChatHumanCheck` type (exported from `@boldare/askdare/react` and `@boldare/askdare/next`), and `ChatState.humanCheck`;
   - the text keys `humanCheck.label` and `error.humanCheck`.
2. **How the check runs:**
   - It runs only when a new session starts, after the session rate limit and with a 10 s timeout.
   - Renewing a live session needs no new check for **24 hours** after the visitor passed one. The access token carries the time of the check (an `hv` claim), and a renewal keeps it, so the 24 hours can't be extended by renewing. After them, or for a token without the claim (issued before the bot turned the check on), the server asks again; the client sends the check with the old token, so the visitor keeps their session. Bots without a verifier issue and renew tokens as before.
   - The chat renders the widget with the bot's id as Turnstile's `action` (cut to Turnstile's 32 characters), and the server refuses a token whose siteverify `action` differs. The `hostname` check is optional (`hostnames`): behind a proxy that serves the app under another name it would refuse every visitor, and the widget's hostname list in the Cloudflare dashboard already limits where it runs. Cloudflare's test secret keys return no `action` and always `example.com`, so with them neither is checked.
   - Turnstile retries transient errors by itself (`retry: 'auto'`); the chat fails the check at the third `error-callback`.
   - `identify()` with a token opens a session at once, to find that user's conversation, so signed-in visitors meet the check as the chat loads. Anonymous visitors meet it at their first action; signing out without a session opens none.
   - A failed token answers `unauthorized` with `error.humanCheck`.
   - A check that can't run refuses the session (fails closed). Only bots that turn the check on are affected.
   - The browser receives only `{ provider, siteKey }`.
3. **CSP:** for bots with a verifier only, the iframe adds `https://challenges.cloudflare.com` to `script-src` and `frame-src`. Bots without one keep the 0.4 policy, pinned by a test.
   - **Trust:** Cloudflare's `api.js` then runs with the chat origin's access: in the iframe, your app's origin, and in inline mode the host page. It can read the conversation on screen and the resume token. Cloudflare updates the script in place, so there is no Subresource Integrity. Turning the check on means trusting Cloudflare with that; the docs say so.
4. **`requireSharedStore`:** `createChatHandler` throws when the route loads, in any environment, if the option is on and the store isn't shared. Off by default.
5. **Budget:** `@boldare/askdare/react` may take up to **33 KB** gzipped in an app's bundle. The headless budget (12 KB for `Root` and `useChat`) is unchanged.

## Consequences

- Teams with a public chat can require a human check without custom work.
- The React entry has room for this release. ADR-0017's rule that a further addition needs room made first applies again from 33 KB.
- Not yet verified in a live browser: Turnstile under the widened CSP, and how it looks in the panel. No e2e test yet, because siteverify can't be pointed at the mock server without a new seam.
- A solved challenge buys at most 24 hours of renewals, and tokens issued before the check was turned on don't count as checked.

## Alternatives considered

- **Render the challenge in the loader:** there's no room in its 5 KB budget, and it would load Cloudflare's script on every host page.
- **Make room in the React entry first:** this needs refactoring outside the task. A 1 KB increase is cheaper than delaying the feature.
- **Fail open when Cloudflare is unreachable:** a bot that turned the check on would silently lose the protection it asked for.
