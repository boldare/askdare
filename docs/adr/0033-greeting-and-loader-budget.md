# ADR-0033: A proactive greeting and an unread badge in the loader, and its budget

- **Status:** Proposed
- **Date:** 2026-11-26
- **Amends, once accepted:** [ADR-0005](0005-embedding-model.md) (the loader's budget, and what it may store) and [ADR-0013](0013-browser-events.md) (two events in the catalog).
- **Evidence:** spike S10 ([findings](../../spikes/s10-loader/FINDINGS.md)). Every size below is gzipped and measured as `scripts/inline-assets.mjs` measures the budget: the loader built with the look placeholder.

## Context

0.7 adds two things buyers compare against Intercom and Crisp: a short greeting next to the closed launcher, and a badge on the launcher when an answer arrives while the chat is closed. Both belong to the loader, the only code on the host page. ADR-0005 limits it to 5,120 bytes.

Spike S10 measured the room:
- **The loader is at 5,052 B,** not the 5,016 B ADR-0018 recorded: the full-screen focus fix added 36 B. 68 B are left.
- **With the same behavior it can lose 404 B** (to 4,648 B). Almost all of it comes from two changes: minifying its CSS at build time (−250 B alone), and having the server inline a default look instead of the loader carrying fallback colors and texts (−129 B alone).
- **The greeting costs about 375 B and the badge about 180 B** on the smaller loader. The cheapest complete version is 5,195 B, 75 B over the budget. Shortening every console warning still leaves it 25 B over.
- **Moving logic out doesn't make it fit.** A greeting in a tiny iframe saves the loader 77 B and still ends 5 B over, while every visitor who sees it downloads a 1,000 B page. A badge count sent by the iframe saves 7 B and changes the bridge protocol and `EmbedRoot`.
- **Only a second script keeps 5 KB:** the greeting's code fetched when its delay ends (5,015 B, plus a 792 B script for bots with a greeting).

## Decision

### 1. The loader gets smaller first, with the same behavior (l1)

In this order, each measured in the findings:
1. Its CSS moves to `loader.css`, imported with `?inline`, so Vite minifies it with Lightning CSS. `vite.loader.config.ts` sets `build.cssTarget` to the supported browsers (Chrome and Edge 111, Firefox 121, Safari 16.4).
2. The panel's surface colors per scheme are declared once, as `--bg` and `--fg` on `:host`.
3. The `<style>` fallback for Safari before 16.4 goes; every supported browser has constructed stylesheets.
4. `fill` attributes that draw nothing go from the icons.
5. The server always inlines a look: the bot's, or a default one under `''` for a script tag with only `data-bot` or an unknown bot. The loader drops its own fallback colors and texts.

That takes it from 5,052 B to 4,648 B. Console warnings keep their wording, the `doctor` hint included.

### 2. The budget becomes 5,632 bytes (5.5 KB)

- `LOADER_BUDGET_BYTES` in `scripts/inline-assets.mjs` becomes 5,632 B, still measured on the build with the look placeholder.
- After l2 the loader is expected at about 5,195 B, 437 B under it. Per page, visitors download about 143 B more than in 0.6.
- **Raising it again needs an ADR,** with the same-behavior savings tried first and measured.

### 3. The greeting is drawn by the loader (l2)

- **Off by default.** A bot turns it on with a delay. The look then carries the delay and the greeting's two texts in each language; a bot without a greeting ships neither. The option's name is settled in l2 with the API review (z1); `widget.greeting` stays the welcome screen's text.
- **Texts:** `launcher.greeting` (the bubble), `launcher.dismiss` (the × button's name) and `launcher.unread` (see 4), added by task c4. The default greeting says it is an AI assistant, as ADR-0019 asks of the chat. The docs say a custom greeting should too.
- **When it shows:** after its delay, only with askdare's own launcher (not inline, not `data-launcher="none"`), only if the chat hasn't been opened on the page, and only if the visitor hasn't already dismissed it or opened the chat in this session.
- **How a page turns it off:** `data-greeting="off"` on the script tag. A site that wants consent first keeps the attribute until it has it.
- **Storage:** one `sessionStorage` key on the host page's origin, `askdare:<bot>:greeted`, written only when the visitor dismisses the greeting or opens the chat. If storage is blocked, the greeting doesn't show. ADR-0005's rule becomes: nothing is written before the visitor acts on the widget, and never a cookie.
- **Accessibility (WCAG 2.2 AA, ADR-0019):**
  - It never takes focus and isn't a live region. It sits just before the launcher in the shadow root, so the keyboard reaches it right before the launcher.
  - × (24 × 24 px) and Escape dismiss it, and focus goes to the launcher. Clicking the text opens the chat; opening the chat removes it.
  - It uses the panel's entrance animation, which `prefers-reduced-motion` turns off.
  - Text only: built with `textContent`, never parsed as HTML.
- **Browser events** (ADR-0013's catalog, emitted by the loader like `open` and `close`, with no fields): `greeting.shown` and `greeting.dismissed`. Clicking the greeting emits the existing `open`.

### 4. The badge counts events the loader already gets (l2)

- While the panel is closed, each `message.received` with `outcome: 'completed'` adds one. Opening the chat clears it. There is no new bridge message, and `chat/host-bridge.ts` and `EmbedRoot` don't change.
- It is drawn from a `data-unread` attribute on the launcher, by `[data-unread]::after`, and shows `9+` above nine. A site restyles it with `::part(launcher)::after`.
- The count is visual only. The launcher's accessible name gains the `launcher.unread` text ("Ask us, Open chat, new messages"), so no plural rules ship in the loader.
- A site with its own trigger (`data-launcher="none"`) counts the same events with `askdare('on', 'message.received', …)`.
- **Handoff (ADR-0030):** a human agent's reply must reach the page as `message.received`, or the badge misses it.

## Consequences

- l1 is a patch release with no visible change. It needs the server's default look in `server/launcher.ts`, unit tests that inline a look, and new visual baselines (Lightning CSS reorders declarations).
- l2 adds public API (ADR-0006): the bot option, two events, `data-greeting`, and the three texts. Minor changeset.
- Visitors download about 143 B more on every page, and a bot with a greeting adds its texts to the inlined look (about 110 B for English and Polish).
- A visitor who ignores the greeting sees it again on the next page, after the delay. That is the price of not storing anything before they act.
- The greeting can cover a focused control in the bottom-right corner until it is dismissed (WCAG 2.4.11). l2's e2e checks this on the site demo.
- The budget keeps meaning something only if the rule in decision 2 holds.

## Alternatives considered

- **Keep 5,120 B and load the greeting's code as a second script.** It fits (5,015 B), and the code arrives only when the delay ends, for bots with a greeting. But it leaves 105 B of room, so the next fix hits the wall again. It also adds a second asset to build, hash and serve, a private callback on `window` for the hand-over, and a second request. If the 5 KB figure matters more than the 512 B, this is the fallback.
- **A tiny iframe for the greeting.** It saves the loader 77 B and still doesn't fit. It costs every greeted visitor a 1,000 B page and a request before they show any interest, which the lazy chat iframe exists to avoid. It also needs a second framed route, size messages and a third origin-checked channel, and a transparent frame breaks when the page's color scheme differs.
- **The iframe sends the unread count** (`{ v: 1, type: 'unread' }`). It saves the loader 7 B, but changes the bridge protocol, `host-bridge.ts` and `EmbedRoot`, whose React entry is near its budget.
- **Shorter console warnings.** They save 52 to 101 B, but the longest one is the hint that sends developers to `doctor --origin`. Not needed with the larger budget.
- **Storing the flag when the greeting shows,** so it appears once per session even if ignored. That stores something on the host page before any interaction, and the greeting doesn't justify that.
- **A larger budget without l1's savings.** Visitors would download 587 B more per page instead of 143 B.
