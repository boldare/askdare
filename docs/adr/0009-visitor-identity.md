# ADR-0009: Visitor identity with identify()

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Visitors are anonymous: the server creates a pseudonymous visitor ID, and tools only know that (ADR-0004). Sites with signed-in users need more: a tool that looks up "my orders" must know who "my" is. The model can't be trusted with that. Anything the visitor types, or the page says through `askdare('configure')`, can name someone else.

The identity has to come from the site's backend, which knows who is signed in, and askdare has to be able to check it. Sites are built with any stack, so the check can't depend on ours.

## Decision

- **The site's backend signs a short JWT** with a separate `IDENTITY_SECRET`, shared only between that backend and the askdare app:
  - HS256 only.
  - Required claims: `sub` (the user's ID), `aud` (the bot ID), `iat` and `exp`. At most 24 hours between `iat` and `exp`; an hour or less is recommended.
  - Optional claims: `name`, `email`, and other string, number or boolean claims, up to 2 KB in all. `nbf` is honoured.
  - `IDENTITY_SECRET` must be at least 32 random characters and differ from `CHAT_SECRET`. Without it, identity is off.
- **The page hands it over:** `askdare('identify', token)`, and `askdare('identify', null)` on sign-out. The loader passes it to the iframe with the handshake, or over the port afterwards; the iframe waits for the handshake before its first request, so the first request already carries the identity.
- **The server verifies it with every session request** (the widget resends the page's latest token at each renewal, about every 15 minutes) and puts the identity into the encrypted access token, which expires with the JWT. So the identity ends at `exp` at the latest. A token that fails verification gives an anonymous session that says so (`identified: false`), and the widget logs a warning once. A forged token never reaches a tool. Anything but a token, `undefined` included, signs out, and a failed sign-in or sign-out leaves no session behind that the next request could use.
- **Tools and instructions see it:** `context.identity` with `id`, `name`, `email` and `claims`. Only verified values get there. The OpenAI `safety_identifier` becomes an HMAC of the user's ID.
- **Conversations follow the person, not the browser.** A conversation started while signed in is bound to an HMAC (with `IDENTITY_SECRET`) of the user and bot. Another user, or nobody, on the same browser can't resume it, see its history or delete it: the server answers as if it didn't exist. The same user can, even from a new visitor ID. Signing in during an anonymous conversation adopts it: the server re-issues its handle bound to the user. The widget keeps one handle per user (keyed by that HMAC), so signing out and back in doesn't lose a conversation.

## Consequences

- Identity is as strong as the site's backend and `IDENTITY_SECRET`. Anyone with the secret can sign in as anyone; it belongs in the backend's secrets, never in a page.
- The JWT is a bearer token for its lifetime. Short lifetimes limit what a leaked one is worth. We don't track `jti`: the page that holds the token could ask its backend for a new one anyway. Rotating `IDENTITY_SECRET` ends live identities at the next renewal, and makes earlier signed-in conversations unreachable.
- Sign-out on the site doesn't reach the chat by itself. The page calls `askdare('identify', null)`, or the identity ends at `exp`.
- The identity lives in access tokens, so they grow by up to 2 KB.
- `askdare('identify')`, the JWT claims, `IDENTITY_SECRET` and `context.identity` are public API (ADR-0006).

## Alternatives considered

- **An HMAC of the user ID, without expiry** (as some chat products do). Simpler for sites, but it never expires and carries no audience; a leaked value works forever, for every bot.
- **Asymmetric keys (RS256 or EdDSA), or the site's own OAuth tokens.** Better when the signer and verifier are different organizations; here both are the same site. Can be added later as another algorithm.
- **Passing identity through `askdare('configure')`.** Anyone can call it from the browser console, so it can't be trusted.
