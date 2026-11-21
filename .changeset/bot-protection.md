---
'@boldare/askdare': minor
---

Optional bot protection, both off by default; a bot that turns neither on works as in 0.4.

- **Human check with Cloudflare Turnstile:** `security: { humanVerifier: turnstile({ siteKey }) }` in `defineBot`, with the secret key in `TURNSTILE_SECRET_KEY`. The chat shows the Turnstile widget when it needs a new session, and `/session` checks the token with Cloudflare; renewing a live session needs no new check for 24 hours after the visitor passed one. For that bot only, the iframe's Content Security Policy allows `https://challenges.cloudflare.com` in `script-src` and `frame-src`. A chat inside your page must allow the same origin in your page's policy, and a headless chat renders the new `HumanCheck` primitive. To check tokens another way, implement the `HumanVerifier` type.
- **`limits.requireSharedStore`** in `createChatHandler`: with `true`, the route refuses to load unless `limits.store` is shared, instead of only warning in production.

New texts `humanCheck.label` and `error.humanCheck`, a `human-check` part, and `state.humanCheck` in the React hooks.
