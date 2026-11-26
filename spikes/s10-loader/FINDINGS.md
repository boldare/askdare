# Spike S10: room in the loader for a greeting and an unread badge

- **Brief:** `tasks/0.7-x4-loader-spike.md` (deleted by the branch that finishes it; see git history). Feeds [ADR-0033](../../docs/adr/0033-greeting-and-loader-budget.md), then tasks l1 and l2.
- **Date:** 2026-11-26. Vite 8.3.8 (as `packages/askdare`), Node 22.21. No OpenAI calls, no cost.
- **Method:** `measure.mjs` copies today's `packages/askdare/src/embed/loader.ts`, applies named patches from `patches.mjs` and builds each variant exactly as `vite.loader.config.ts` does (IIFE, `es2020`, default minifier). Sizes are gzipped with zlib's defaults, as `scripts/inline-assets.mjs` measures the 5,120-byte budget, on the build with the `__ASKDARE_LAUNCHERS__` placeholder. `served.mjs` measures what a visitor gets: the same file with a bot's look inlined. Every number below is in `results.json`.
- **Checked in a browser:** `demo/serve.mjs` serves the recommended variant on a host page with a fake chat iframe (Chromium, the desktop app's browser pane). Verified: the greeting shows after its delay without moving focus; it sits in the tab order just before the launcher; Escape and × dismiss it and put focus on the launcher; clicking it opens the chat; nothing is stored when it shows, and after a dismissal or an open it stays away on reload; `data-greeting="off"` suppresses it; the × is 24 × 24 px; the badge counts an answer that arrives while the chat is closed, adds ", new messages" to the launcher's name and clears when the chat opens. Not checked: Firefox, WebKit, a screen reader, `prefers-reduced-motion` (the rule is in the built CSS, but no emulation was run).

## Verdict

**Today's loader is 5,052 B, not 5,016 B.** The full-screen focus fix (`5d745bf`) added 36 B after ADR-0018 recorded 5,016 B, so 68 B are left. The repository's own build gives the same 5,052 B.

**Nothing fits a greeting and a badge under 5,120 B without dropping behavior.** The loader can lose 404 B with the same behavior (4,648 B). The greeting costs about 375 B and the badge about 180 B on top, so the cheapest complete version is 5,195 B, 75 B over. Shortening every console warning still leaves it 25 B over and costs developers the hints.

**Recommendation** (ADR-0033):
1. **l1 makes the loader 404 B smaller** with the same behavior: 5,052 → 4,648 B.
2. **l2 draws the greeting in the loader** (not in an iframe), and shows the badge as a `data-unread` attribute counted from the `message.received` events the loader already gets. That gives 5,195 B.
3. **The budget becomes 5,632 B (5.5 KB),** leaving 437 B of room after l2. Per page, visitors get 143 B more than today.

If the 5 KB budget must hold, the alternative is to load the greeting's code as a second script (5,015 B, plus a 792 B script and a request for bots with a greeting). It works, but it leaves 105 B of room, adds a second asset to version and serve, and needs a private callback on `window`.

## Answers

### 1. How much can the loader lose with the same behavior?

Cumulative, in the order l1 should apply them:

| Step | Gzip | vs today | What changes |
|---|---:|---:|---|
| today | 5,052 | | `loader.ts` as on `release/0.7` |
| 1. CSS in a file | 4,802 | −250 | `STYLES` moves to `loader.css`, imported with `?inline`, so Vite minifies it with Lightning CSS: comments and whitespace go, `rgb(15 23 42 / .45)` becomes `#0f172a73`. Needs `build.cssTarget` set to the supported browsers, or Lightning CSS expands `system-ui` into a long font list. |
| 2. Surface colors once | 4,796 | −256 | `--bg` and `--fg` on `:host`, set per color scheme in one place, instead of a dark rule and a dark media query for the orb and for the panel each. The greeting reuses them. |
| 3. No `<style>` fallback | 4,780 | −272 | Every supported browser (Chrome and Edge 111, Firefox 121, Safari 16.4; `docs/support.md`) has constructed stylesheets. |
| 4. Icon attributes | 4,776 | −276 | `fill` attributes that draw nothing. |
| 5. Default look from the server | **4,648** | **−404** | The server always inlines a look: the bot's, or a default one under `''` for a tag with only `data-bot` or an unknown bot. The loader drops its fallback colors, English texts and every `look?.`. |

Each one alone, on today's loader: CSS file −250, surface −6, no fallback −15, icons −5, server defaults −129. Left out of the lean set one at a time: CSS file +154, surface +6, no fallback +15, icons +4, server defaults +128. So the CSS file and the server's default look carry almost all of it. The small three still pay for themselves, and the surface variables are needed by the greeting anyway.

Tried and rejected:

| Idea | Effect | Why not |
|---|---:|---|
| `make()` and `attr()` helpers for `createElement` and `setAttribute` | +18 alone, +17 on lean | gzip already compresses the repeated calls better than the helpers. |
| The font stack once on `:host` | +6 alone, +2 on lean | Buttons don't inherit fonts, so the launcher still needs a `font` rule. |
| Host event fields as strings (`'length attachments source'`) | −7 alone, −3 on lean | Loses the compile-time check that keeps the field list in step with `ChatEvent`. |
| Shorter warnings, the `doctor` hint kept | −48 alone, −52 on lean | Optional. Not needed with the larger budget. |
| All warnings shorter | −94 alone, −101 on lean | Drops the hint that sends developers to `doctor --origin`, the most useful message the loader has. |

What a visitor downloads with a typical look inlined (circle launcher, English and Polish texts): today 5,301 B; lean 4,954 B; lean with the greeting and the badge 5,500 B for a bot without a greeting and 5,613 B for one with it. The budget never counted the look, and this spike doesn't propose that it should; the look is data the server controls.

### 2. A greeting drawn by the loader, or a tiny early iframe?

| Variant | Loader gzip | On lean | Per visitor, besides the loader |
|---|---:|---:|---|
| Bubble drawn by the loader | 5,024 | +376 | nothing |
| Tiny iframe loaded before the chat | 4,947 | +299 | a 1,000 B page (`greeting-frame.html`, about the smallest it can be) and a request to the app on every page view that shows it |
| The bubble's code in a second script | 4,836 | +188 | a 792 B script (`greeting-chunk.ts`) and a request, for bots with a greeting |

**The loader-drawn bubble wins.** The iframe saves the loader only 77 B, and in exchange:
- every visitor who sees a greeting downloads about 1 KB more and makes a request to the app before showing any interest, which ADR-0005's lazy iframe exists to avoid;
- the bubble can't size itself, so the loader has to listen for its height; the app needs a second framed route with the bot's `frame-ancestors`; and a transparent iframe whose `color-scheme` differs from the page's gets an opaque background;
- it adds a third origin-checked message channel (`askdare:greeting`) to the security-relevant bridge.

The second script is the only option that keeps the 5 KB budget (see the verdict). Its loader side is mostly the same gate as the bubble's (when to show, storage, the site's switch), which is why it saves only 188 B.

Two smaller choices inside the bubble:
- **The `greeting.shown` and `greeting.dismissed` events cost 18 B.** They are what a site needs to measure the greeting, so they stay. Clicking the greeting emits the existing `open`.
- **No `innerHTML`.** The bubble is built with `createElement` and `textContent`, so the greeting text is never parsed as HTML. (See "Also found" for the icons.)

### 3. The unread count over the host bridge

| Variant | Loader gzip | On lean |
|---|---:|---:|
| Badge element, counted from `message.received` | 4,846 | +198 |
| Badge element, the iframe sends `{ v: 1, type: 'unread', count }` | 4,839 | +191 |
| `data-unread` attribute and `::after`, counted from `message.received` | **4,828** | **+180** |

**Count the events the loader already gets; no new bridge message.** The iframe already sends `message.received` to the loader for `askdare('on')`. Counting completed answers that arrive while the panel is closed costs nothing in the protocol, in `chat/host-bridge.ts` or in `EmbedRoot` (whose React entry is near its budget). A new `unread` message would save the loader 7 B and cost all three.

It also keeps the badge honest for sites that open the chat from their own button (`data-launcher="none"`): they can count the same events with `askdare('on', 'message.received', …)` and draw their own badge.

The attribute version is the cheapest, and a site can restyle it with `::part(launcher)::after`. The launcher's accessible name gains the bot's `unread` text ("Ask us, Open chat, new messages"). The count is visual only (`9+` above nine), so no plural rules ship in the loader.

**One dependency:** the badge counts what arrives as `message.received`. A reply from a human agent after a handoff (ADR-0030, 0.7) must reach the page as `message.received` too, or the badge misses exactly the messages it matters most for. That is for x1 and c1/c2 to settle.

The iframe exists only after the first open, so the badge can only appear after the visitor has opened the chat on this page. That is the case it is for: an answer, or an agent's reply, that arrives after the visitor closed the panel.

### 4. When the greeting shows, how a site turns it off, and the WCAG 2.2 AA rules

As built and checked in the spike:

- **Off by default.** A bot turns it on with a delay; the look then carries `greet` (the delay in ms) and the `greeting` and `dismiss` texts in each language. A bot without a greeting ships neither.
- **It shows** once the delay has passed, only with askdare's own launcher (not inline, not `data-launcher="none"`), only if the chat hasn't been opened on this page, and only if this session hasn't dismissed it or opened the chat.
- **A page turns it off** with `data-greeting="off"` on the script tag. A site that wants consent first can keep the attribute until it has it.
- **Storage:** one `sessionStorage` key on the host's origin, `askdare:<bot>:greeted` = `1`, written only when the visitor dismisses the greeting or opens the chat. Nothing is written when it merely shows, so ADR-0005's rule ("nothing is written before the visitor's first message") changes only to "nothing before the visitor acts on the widget". If storage is blocked, the greeting doesn't show at all, rather than on every page. No cookies.
  - Trade-off: a visitor who ignores the greeting sees it again on the next page, after the delay. Writing the flag when it shows would stop that, but it stores something before any interaction, which the greeting doesn't justify.
- **No focus steal:** it never takes focus and isn't a live region, so it doesn't interrupt a screen reader. It sits in the shadow root just before the launcher, so keyboard users reach it right before the launcher.
- **Dismissible:** a × button (24 × 24 px, WCAG 2.5.8) named by the bot's `dismiss` text, and Escape while focus is inside. Dismissing puts focus on the launcher, never on the page's `<body>`. Opening the chat removes it.
- **Reduced motion:** it uses the panel's `in` animation, and the existing `prefers-reduced-motion` rule turns it off.
- **AI disclosure (ADR-0019):** the default text says it is an AI assistant ("Hi! I'm the AI assistant. Any questions?"); the docs must say a custom greeting should too. It costs no loader bytes.
- **Not solved here:** WCAG 2.4.11 (focus not obscured). The bubble is fixed to the bottom right like the launcher, and up to 300 px wide, so it can cover a focused control in that corner until the visitor dismisses it. l2's e2e should tab through the site demo with the greeting open and check nothing focused is hidden.
- A language switch while the bubble is visible doesn't change its text (it shows until dismissed). Not worth bytes.

## Also found

- **The loader breaks under Trusted Types** (pre-existing). It sets the launcher's icons with `innerHTML`, which throws on a page with `require-trusted-types-for 'script'`, so the launcher never mounts there. Building the two SVGs with `createElementNS` would fix it; not measured here.
- **`docs/support.md` says the loader is "about 3 KB"**; it is 5,052 B today. `ROADMAP.md` and ADR-0018 say 5,016 B. l1 updates `docs/support.md`.
- **Lightning CSS reorders declarations** and rewrites colors and `max-width` media queries to range syntax (`width<=480px`), which all supported browsers read. Visual baselines should still be rerun in l1.

## Files

- `patches.mjs`: every measured change, as small named patches l1 and l2 can replay by hand.
- `measure.mjs`: builds and measures every variant (`node measure.mjs --json results.json`); `results.json` is its output.
- `served.mjs`: sizes with a bot's look inlined.
- `greeting-frame.html`, `greeting-chunk.ts`, `greeting-chunk.css`: the other side of the iframe and second-script variants.
- `demo/serve.mjs`: the host page and fake chat for the browser check (`node demo/serve.mjs`, port 4610).

To rerun: `npx pnpm@12.16.1 install --ignore-workspace`, then `node measure.mjs` and `node served.mjs`.
