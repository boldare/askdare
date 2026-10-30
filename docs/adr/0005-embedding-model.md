# ADR-0005: Embedding model (loader + iframe served by the route handler)

- **Status:** Accepted for 0.1 (2026-10-30). Spikes S3 (hosting) and S4 (browsers) did not run as separate spikes. The e2e suite covers the embedding on two origins, and real hosts (Vercel, Heroku) and mobile Safari are checked by hand before 0.1.0.
- **Date:** 2026-10-29

## Context

The widget must run on any website, not only Next.js ones. It must not be broken by the host page's CSS, CSP, layout, i18n or auth proxy. Secrets must never reach the host page.

v1 used an iframe, but it had a broken script API, `postMessage('*')` and no origin checks.

## Decision

- **Loader:**
  - A `<script>` loader under 5 KB gzipped, served at `/api/chat/widget.js`.
  - It is served with short caching (`max-age=300, stale-while-revalidate`). A hashed, immutable URL with SRI support is planned for step 4.4.
  - It renders the launcher in a shadow root, which host CSS can style through `::part`.
  - It creates the iframe lazily, on first open.
- **iframe:**
  - It points at a page served by the **library's own route handler**. The prebuilt iframe app (written against React's API, built with Preact and Vite 8, about 34 KB gzipped) is inlined into the package as string modules, with no runtime file-system reads. The app runs alone in its iframe, so Preact is invisible to sites; the headless React package for 0.2 (ADR-0008) stays on React.
  - The host app's layout, Tailwind, proxy or Cache Components settings can't affect it.
  - The API is same-origin with the iframe, so **no CORS** is needed.
- **Headers** on the embed response:
  - `Content-Security-Policy: frame-ancestors <per-bot allowlist>`;
  - `Permissions-Policy` that disables camera and geolocation, and allows the microphone (`microphone=(self)`) only for a bot with voice input;
  - `Cross-Origin-Opener-Policy: same-origin`.
- **iframe attributes:** `allow="clipboard-write; microphone"` (the embed page's `Permissions-Policy` still decides per bot), a `title`, `referrerpolicy="strict-origin"`.
- **Handshake:**
  1. The loader knows the app origin from `script.src`.
  2. After `load`, it posts `init` with an explicit `targetOrigin` and transfers a `MessagePort`.
  3. The iframe checks `event.origin` against the allowlist, and the loader checks `event.source === iframe.contentWindow`.
  4. Messages are versioned (`v`), and unknown messages are ignored.
- **Storage:**
  - Best effort: partitioned `localStorage` inside the iframe, wrapped in try/catch.
  - Nothing is written before the visitor's first message. No cookies.
- **Streaming:**
  - SSE over POST.
  - The first byte goes out before calling OpenAI, then a heartbeat every 15 s. Heroku requires a first byte within 30 s and then one every 55 s.
  - An app-level deadline per turn, the bot's `limits.turnTimeoutMs` (120 s by default), ends the stream with an `error` event with code `timeout`. It must stay below the route's `maxDuration`, which `doctor` checks; Vercel duration limits apply.
  - Aborting is best effort.
- **Inline mode:** `data-mode="inline" data-target="#chat"`.

## Consequences

- Full CSS and JS isolation, and secrets stay on our origin.
- Glass effects inside the iframe can only blur the panel's own background, never the host page. Only the launcher (shadow DOM on the host) can blur host content.
- Resizing, focus and Escape handling have to cross the frame boundary through the port.
- Users with strict host CSPs must allow our origin in `script-src` and `frame-src`. [Embedding](../embedding.md) documents this. `doctor` can't see the host page, so it checks only the app's side (`--origin`: the site is in `frame-ancestors`).

## Alternatives considered

- **Web component in the host page.** Rejected: host CSS and fonts leak in, the host CSP must allow our API, and CORS is required.
- **Embed page rendered inside the user's Next app.** Rejected for 0.1: the host layout and proxy can break it. It returns in 0.2 as an opt-in `embedPath`.
- **npm React component only.** Rejected: it doesn't serve non-React hosts.
