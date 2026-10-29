# ADR-0009: Visitor identity with identify()

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Visitors are anonymous: the server creates a pseudonymous visitor ID, and tools only know that (ADR-0004). Sites with signed-in users need more: a tool that looks up "my orders" must know who "my" is. The model can't be trusted with that. Anything the visitor types, or the page says through `chatdock('configure')`, can name someone else.

The identity has to come from the site's backend, which knows who is signed in, and chatdock has to be able to check it. Sites are built with any stack, so the check can't depend on ours.

## Decision

- **The site's backend signs a short JWT** with a separate `IDENTITY_SECRET`, shared only between that backend and the chatdock app:
  - HS256 only.
  - Required claims: `sub` (the user's ID), `aud` (the bot ID), `iat` and `exp`. At most 24 hours between `iat` and `exp`; an hour or less is recommended.
  - Optional claims: `name`, `email`, and other string, number or boolean claims, up to 2 KB in all. `nbf` is honoured.
  - `IDENTITY_SECRET` must be at least 32 random characters and differ from `CHAT_SECRET`. Without it, identity is off.
- **The page hands it over:** `chatdock('identify', token)`, and `chatdock('identify', null)` on sign-out. The loader passes it to the iframe with the handshake, or over the port afterwards; the iframe waits for the handshake before its first request, so the first request already carries the identity.
- **The server verifies it once,** when the iframe opens a session, and puts the identity into the encrypted access token. Renewals keep it until the JWT's `exp`. A token that fails verification gives an anonymous session that says so (`identified: false`), and the widget logs a warning. A forged token never reaches a tool.
- **Tools and instructions see it:** `context.identity` with `id`, `name`, `email` and `claims`. Only verified values get there. The OpenAI `safety_identifier` becomes a hash of the user's ID.
- **Conversations follow the person, not the browser.** A conversation started while signed in is bound to a hash of the user and bot. Another user, or nobody, on the same browser can't resume it, see its history or delete it: the server answers as if it didn't exist. An anonymous conversation may continue after sign-in.

## Consequences

- Identity is as strong as the site's backend and `IDENTITY_SECRET`. Anyone with the secret can sign in as anyone; it belongs in the backend's secrets, never in a page.
- The JWT is a bearer token for its lifetime. Short lifetimes limit what a leaked one is worth. We don't track `jti`: the page that holds the token could ask its backend for a new one anyway.
- Sign-out on the site doesn't reach the chat by itself. The page calls `chatdock('identify', null)`, or the identity ends at `exp`.
- The identity lives in access tokens, so they grow by up to 2 KB.
- `chatdock('identify')`, the JWT claims, `IDENTITY_SECRET` and `context.identity` are public API (ADR-0006).

## Alternatives considered

- **An HMAC of the user ID, without expiry** (as some chat products do). Simpler for sites, but it never expires and carries no audience; a leaked value works forever, for every bot.
- **Asymmetric keys (RS256 or EdDSA), or the site's own OAuth tokens.** Better when the signer and verifier are different organizations; here both are the same site. Can be added later as another algorithm.
- **Passing identity through `chatdock('configure')`.** Anyone can call it from the browser console, so it can't be trusted.
