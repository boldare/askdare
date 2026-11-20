# ADR-0018: Your own page inside the widget's iframe (`embedPath`)

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

The script-tag widget renders askdare's own skin in an iframe that the library's route serves ([ADR-0005](0005-embedding-model.md)). That page is prebuilt with Preact and can't import a site's code, so:
- tool cards ([ADR-0017](0017-tool-renderers.md)) arrive in the widget but nothing draws them;
- a site that ejected the skin (`add ui`) or built its own markup ([ADR-0011](0011-react-api-and-inline-chat.md)) gets that look only in the chat inside its own pages, never in the widget on other sites.

ADR-0005 rejected rendering the iframe's page inside the user's Next app for 0.1, because the host app's layout and proxy could break it, and planned it as an opt-in `embedPath`. Since 0.2 the primitives, the skin and `getChatConfig` work in an app's own pages, so the page can be built from them.

The constraints:
- **The loader** is at 4,963 of its 5,120 bytes (gzipped).
- **The bridge** between the loader and the iframe (a `MessagePort` handed over after an origin check, ADR-0005) is security-relevant and must stay one implementation.
- **The iframe's headers** (`frame-ancestors`, `Permissions-Policy`) are what keep other sites from framing the chat and keep the microphone off for bots without voice. A page of the app gets the app's headers, not the library's.
- **[ADR-0004](0004-threat-model.md):** the client never chooses the model, instructions, tools or conversation IDs.

## Decision

### Configuration: a bot option, followed by a redirect

- **`defineBot({ embedPath: '/askdare/support' })`**, server configuration only. `defineBot` accepts a path on the same app: it starts with one `/`, has no `//`, `\`, query or fragment, and isn't inside the chat route's `basePath`. Each bot that wants its own page sets it; others keep the library's page.
- **The loader keeps its URL.** It still opens `<basePath>/embed/<bot>?lang=&mode=`. For a bot with `embedPath`, the route answers that request with a `302` to `embedPath`, keeping `lang` and `mode` and nothing else, with `Cache-Control: no-store`. The language switch that reloads the iframe (ADR-0014, step 1) goes through the same redirect. The gallery (`?gallery=`) and the `/config` route stay on the library's page.
- **Same origin only.** The redirect never leaves the app, so the loader's handshake (`postMessage` to the app's origin, `event.source === iframe.contentWindow`) works unchanged.
- **A page that runs late asks for the handshake** (added during implementation, task 3c). The loader sends `askdare:init` once, when the iframe has loaded. askdare's own page runs its script before that; a Next.js page may hydrate after it (WebKit does so reliably), and would never connect. So `EmbedRoot`'s bridge posts `{ v: 1, type: 'askdare:hello' }` to its parent, addressed to the app's origin and each allowed origin, while it has no handshake. The loader answers a hello only from its own iframe (`event.source === iframe.contentWindow`) still on the app (`event.origin === appOrigin`), with a new `askdare:init` exactly as on load. The bridge in hello mode takes the newest handshake, so a hello that crosses the load handshake can't leave the two sides on different ports. askdare's own page never says hello and keeps the first handshake, as before. It costs the loader 53 bytes (5,016 of 5,120).

### The page at `embedPath`

- **A new entry, `@boldare/askdare/embed`** (client, `'use client'`), so the bridge never weighs on `@boldare/askdare/react` (32,390 of its 32,768 bytes). It exports:
  - **`EmbedRoot({ config, toolRenderers?, children })`**: `Root` for the iframe. It creates the chat store, joins the loader's bridge with the existing `connectToHost` and `bindBridge` (identity, `configure`, events for `askdare('on')`, hiding), and follows language switches with the existing `switchLocale`. It takes no `identity`, `context`, `greeting` or `starters` props: those come from the host page through the bridge, as in the library's iframe.
  - The chat inside it is the site's own: `DefaultChat`, an ejected skin or its own markup, with `toolRenderers` drawn as in a page.
- **`getEmbedConfig({ bots, bot, searchParams })`** in `@boldare/askdare/next` reads `lang` and `mode` from the page's search parameters and returns what `EmbedRoot` needs: `getChatConfig`'s public configuration, the bot's allowed origins for the handshake, and the mode. Nothing it returns is secret; the "no secrets" test covers it.
- **Inside `EmbedRoot`, `DefaultChat` owns the document,** as the library's iframe does: its heading is an `h1`, the "start over" question is modal, Escape closes from anywhere, and it shows a close button that asks the loader to close the panel (none in `inline` mode). A small context in `@boldare/askdare/react` carries this; `DefaultChat` outside `EmbedRoot` doesn't change.
- **Opened directly** (not in the loader's iframe), the page works as a standalone chat, as the library's page does.

### Headers

- **The page needs the iframe's headers**, and the library can't set them on a page of the app. `@boldare/askdare/next` exports **`embedPageHeaders({ bots, bot })`**, the same headers the library's page sends that apply to any page:
  - `Content-Security-Policy: frame-ancestors 'self' <the bot's allowedOrigins>`;
  - `Permissions-Policy: camera=(), geolocation=(), microphone=(self)` with voice, `microphone=()` without;
  - `Referrer-Policy: strict-origin`.

  The docs set them per request in `proxy.ts`. `headers()` in `next.config.ts` works only when the allowed origins are known when the app is built: Next.js evaluates it at build time, so origins read from the environment where the app runs (as the starter's `ASKDARE_ALLOWED_ORIGINS`) would be missing, and the widget couldn't open on those sites (found during implementation; `doctor` reports it). The library's full CSP (`script-src 'self'`, no inline script) isn't among them: a Next page needs inline scripts, so the app's own CSP applies there, as for the chat inside a page (ADR-0011).
- **`Cross-Origin-Opener-Policy`** is left out: it has no effect on a framed document, and an app may set its own.

### `doctor`

For a bot with `embedPath`, `askdare doctor` follows the redirect and checks:
- the page answers `200` with HTML that contains `EmbedRoot`'s marker (`data-askdare-embed`);
- its `frame-ancestors` allows the app and every allowed origin, and nothing wider (no `*`, no missing directive);
- its `Permissions-Policy` keeps the microphone off for a bot without voice;
- with `--origin`, that origin may frame it.

A failing check names the missing header and points to `embedPageHeaders`.

### Risks, and how the docs steer around them

- **The app's root layout** wraps every page with its header, navigation, analytics and fonts. The docs put the page in its own route group with its own root layout (`app/(askdare)/layout.tsx` with its own `<html>` and `<body>`), so nothing of the site renders or runs in the widget.
- **`proxy.ts`** (auth redirects, i18n rewrites, bot protection) runs for the page. The docs show excluding the path in the proxy's `matcher`. `doctor`'s `200` check catches a redirect to a login page.
- **Scripts in the iframe** run with the chat route's origin, so they can read the visitor's tokens, as in the chat inside a page. The separate root layout keeps third-party scripts out; the docs say the page must not load any.
- **Without the headers**, any site can frame the page (clickjacking) and the microphone policy is the app's. `doctor` fails on a missing or wider `frame-ancestors`.
- **Caching.** The page reads `searchParams`, so it renders per request; the docs say not to cache it. With Cache Components (the starter's setting) that read must sit inside `<Suspense>`, or the build fails; the docs' example does so, and `verify-packs` builds it in the starter (found during implementation).

## Evidence

Built in tasks 3b and 3c (November 2026), on `release/0.4`:
- **e2e** (`e2e/embed-root.spec.ts`, Chromium, Firefox and WebKit): from a host page on another origin, the widget of the site's `own-page` bot opens `/askdare/own-page`, draws a tool card, follows `askdare('identify')`, `configure`, `on` and a language switch, and closes from its button; a host page outside the allowlist can't frame it. All library iframe tests and visual baselines pass unchanged.
- **WebKit** delivered the load handshake before the page's scripts ran, every time; without the hello the chat never connected there.
- **`doctor`** against the dev server passed the page with the headers and named `embedPageHeaders` when they were missing.
- **Sizes** (gzipped): the loader 5,016 of 5,120 bytes; a page with `EmbedRoot` and the hooks 11,174 bytes (budget 14,336); `react.js` 32,037 bytes.

## Consequences

- **New public API (ADR-0006, a minor version):**
  - the `embedPath` bot option;
  - the `@boldare/askdare/embed` entry with `EmbedRoot`, and its size budget;
  - `getEmbedConfig` and `embedPageHeaders` in `@boldare/askdare/next`;
  - the `data-askdare-embed` marker that `doctor` looks for.
- **The loader answers one new message,** the hello, and the library's iframe doesn't change: its visual baselines stay as they are.
- **Tool cards and ejected skins reach the widget** on every site that embeds it, for bots that opt in.
- **The site owns more:** the page's layout, headers and proxy exclusions. A mistake there weakens the iframe's isolation, which is why `doctor` checks it and why the library's page stays the default.
- **The bridge stays one implementation,** now running in the library's iframe (Preact) and in the site's page (React); it is tested under both.
- **The first open takes one more round trip,** for the redirect. The page is the app's own, so its first load is as fast as the app's pages.

## Alternatives considered

- **Holding the handshake only in the page's own script** (`holdHandshake`, kept as a first line of defence). It can't help when the scripts run after the load event, which WebKit showed they do.
- **The loader builds the page's URL** (an `embedPath` in the launcher look it already inlines). It costs loader bytes the budget doesn't have, and puts a server decision in the browser. The redirect costs no bytes and keeps the route in charge.
- **A Next rewrite or the proxy serving the page at `<basePath>/embed/<bot>`.** It needs configuration in every app, and a rewrite into the route's own path collides with the handler.
- **The library rendering the site's components in its own page** (importing them into the prebuilt iframe app). The iframe app is built once, inside the package; it can't bundle a site's code.
- **`embedPath` in the loader's `data-*` attributes.** The page that embeds the widget would choose what renders inside the app's iframe, a decision that belongs to the app.
- **Setting the headers from `EmbedRoot`.** A client component can't set response headers, and `<meta http-equiv>` doesn't support `frame-ancestors`.
- **`EmbedRoot` in `@boldare/askdare/react`.** The bridge, the locale switch and the handshake would add about 1.5 KB to an entry that has under 400 bytes left, for pages that never run in an iframe.
