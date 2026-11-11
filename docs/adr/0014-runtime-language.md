# ADR-0014: Changing the chat's language at runtime

- **Status:** Accepted. Amends the `configure` allowlist of [ADR-0008](0008-ui-customization-and-themes.md).
- **Date:** 2026-11-11

## Context

A bot set to `locale: 'auto'` picks its language once, when the chat loads:
- The loader reads the page's `<html lang>` (or the browser's language) and picks the launcher's texts from the look inlined into `widget.js?bot=`, which has English and Polish today.
- It adds `?lang=` to the iframe's URL. The route resolves the locale (`localeFor` in `server/handler.ts`), and `publicConfig()` in `server/public-config.ts` builds the texts for it.
- `getChatConfig({ locale })` does the same for a chat inside a page ([ADR-0011](0011-react-api-and-inline-chat.md)). `Root` keys its store by base path, bot and locale.

Sites that switch language without a page load (a language menu in a single-page app, a `lang` attribute set by an i18n library) keep a chat in the old language. The visitor's conversation must not be lost when the language changes.

Two facts make a switch cheap:
- **The conversation doesn't depend on the language.** The resume key in the browser's storage is `askdare:<bot>:resume` (plus the identity key), with no locale in it.
- **The server takes the locale with every message** (`body.locale` in `sendMessage`), so the next answer follows the new language without any server state.

## Decision

Only bots with `locale: 'auto'` switch. A bot with a fixed locale ignores a switch and logs a console warning that names the bot, because its owner chose the language on purpose.

### Step 1 (0.3): reload in the new language

- **`askdare('configure', { locale })`** sets the chat's language. The value is a BCP 47 tag, checked the same way as the bot's `locale` (`canonicalLocale`); anything else is dropped by the loader and ignored by the iframe.
- **`data-follow-lang` on the script tag** watches `<html lang>` with a `MutationObserver` and switches on every change. An explicit `configure({ locale })` wins over it until the next `lang` change.
- **The loader does the switch:**
  1. It recomputes the launcher's texts from the inlined look (English and Polish today; other languages fall back to English, as on first load).
  2. It rebuilds `embedUrl` with the new `?lang=`.
  3. If the iframe exists, it reloads it. The chat restores the conversation from the resume token as after any reload, and the earlier `configure()` call is sent again over the new port, as now.
- **An answer that is still streaming is cut off in the browser.** The chat reports `message.received` with `outcome: 'stopped'` ([ADR-0013](0013-browser-events.md)) before the reload. The server finishes the turn and settles its cost as for any disconnect ([ADR-0004](0004-threat-model.md)), so the answer is stored in the conversation; a history loaded before the turn ends may not show it yet.
- **React** keeps re-creating the store when `getChatConfig` is called with another locale, because `Root` keys it by locale. That already works; step 1 only documents it, together with the same `stopped` event.

### Step 2 (0.4): switch in place

- **Per-language texts.** `widget.texts` also accepts `{ en: {...}, pl: {...} }`, one set of overrides per language. The flat form stays valid and means "the bot's locale", or English for `auto`.
- **`GET <basePath>/config/<bot>?lang=`** returns the public configuration for that language, built by `publicConfig()` like the iframe's and `getChatConfig`'s, so the "no secrets" test covers it.
- **The store gets `setLocale(locale)`.** It fetches that configuration, swaps the texts and the locale, and keeps the messages, the draft and any turn in progress. The client's locale becomes mutable, so the next message carries the new one.
- **The bridge gets a `locale` message**, so the loader switches the iframe without reloading it.
- **React keys the store without the locale** and calls `setLocale` when the prop changes, so a switch no longer resets the chat.

### Not decided here

More built-in dictionaries than English and Polish, and right-to-left layouts, come later. Each needs its own texts and visual baselines.

## Consequences

- **New public API ([ADR-0006](0006-support-matrix-and-versioning.md)):**
  - `locale` in `askdare('configure')` and `data-follow-lang` (step 1);
  - the per-language form of `widget.texts`, the `/config/<bot>` endpoint and `setLocale` (step 2).
- **ADR-0008 changes:** `configure` accepts texts, starters, page context **and the locale**. The locale is not a secret and changes only what the visitor reads and the language the server asks for. The client still never chooses the model, instructions or tools (ADR-0004).
- **Step 1 costs a reload:** the history request (about 2 s, [ADR-0003](0003-conversation-state.md)) runs again, and an answer in progress disappears from view. Step 2 removes both.
- **A conversation can mix languages.** Earlier answers stay in the language they were written in; only new answers and the interface follow the switch.
- **Fixed-locale bots behave as now.** The warning tells a site owner why the switch did nothing.

## Alternatives considered

- **Switch in place from the start.** It needs per-language texts, a new endpoint and a mutable client at once. Step 1 ships the visible behavior with only loader changes, and step 2 removes the reload later without changing the page's API.
- **Every bot switches, fixed locales included.** It overrides a choice the site owner made, for instance a bot whose knowledge base exists in one language only.
- **A new conversation per language.** Simpler, but visitors lose their conversation for clicking a language menu.
- **Ship every dictionary in the iframe and translate in the browser.** It grows the 50 KB iframe budget with every language and puts bot texts for languages the visitor never uses into every page load.
- **Follow `<html lang>` always, without `data-follow-lang`.** Some sites set `lang` per section or for a translation plugin; an automatic switch would surprise them. Following is opt-in.
