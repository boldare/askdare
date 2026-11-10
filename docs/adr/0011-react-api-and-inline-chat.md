# ADR-0011: Headless React API and the chat inside a page

- **Status:** Proposed
- **Date:** 2026-11-10

## Context

ADR-0008 promised layers 4 and 5 for 0.2: a headless React API and an eject command. It also promised that the UI would be built as layers "from day one", so that 0.2 would only expose existing code. That didn't happen in 0.1:
- All of the widget's state lives in one 930-line `App` component (`src/widget-app/app.tsx`). Only `ChatClient` is free of React.
- The stylesheet assumes it owns the document. It has rules for `:root`, `html`, `body` and `*`, and 57 `:root[data-ask-*]` variant selectors.
- The iframe app is written against React's API but built with Preact 11, which is a tenth of the size.

React users want the chat in their own pages (a help center, a docs page, a dashboard) with their own markup, not a floating iframe. Rendering the chat in the host page removes the isolation that ADR-0004 and ADR-0005 rely on, so the security model has to be restated for it.

`embedPath` (custom UI inside the iframe on other sites) and `toolRenderers` (React components for tool results) were also planned for 0.2. They move to 0.3, so that 0.2 ships one new way to render the chat.

## Decision

### Layers

The code splits into three layers in `packages/askdare/src/`:

| Directory | Holds | Depends on |
|---|---|---|
| `chat/` | The browser core, without React: `ChatClient`, storage, the recorder, file preparation, the event reducer, the chat store and a fixture store for the gallery | `protocol/`, `i18n/` |
| `react/` | Hooks, primitives and `skin/`, the default look. `skin/` is what `add ui` copies | `chat/` |
| `widget-app/` | Only what belongs to the iframe: the entry point, the host bridge, `bindBridge` (the bridge wired to the store), `frame.css` and the gallery fixtures | `react/`, `chat/` |

- **The store** (`createChatStore`) holds everything sending needs: the messages, the phase (`starting`, `loading`, `ready`), whether a turn runs, the error, the activity line, the draft, the files on their way, the dictation and the visitor's ratings. It has `subscribe`, `getSnapshot` and `getServerSnapshot` for `useSyncExternalStore`, the actions, and idempotent `start()` and `stop()`, so React's Strict Mode can run effects twice.
- **Components keep only what is about the DOM:** the "new conversation?" question, files dragged over the chat, the height of the message field, focus, and the microphone level meter, which is written through a ref so it never re-renders.
- **The iframe renders the same skin:** `<ChatProvider store={store}><DefaultPanel headingLevel={1} /></ChatProvider>`. The panel stays a `<main>` with an `<h1>`, as in 0.1.
- **One function builds the public configuration.** `publicConfig()` in `server/public-config.ts` feeds both the iframe's `embedConfig` and the new `getChatConfig`. The "no secrets" test covers it.

### Public API

`@boldare/askdare/react` has flat named exports. `export * as Chat` breaks in React Server Components, so users write `import * as Chat from '@boldare/askdare/react'`.

- **`Root({ config, identity?, context?, greeting?, starters?, children })`** provides the chat and renders no DOM of its own. Its props accept what `askdare('identify')` and `askdare('configure')` accept, checked the same way: a JWT-shaped identity token or `null`, a context of at most 1,000 characters, a greeting of at most 500, and at most four starters of 80.
- **Hooks:**
  - `useChat()` returns `{ state, actions, bot, t }`;
  - `useChatState(select)` re-renders only when the selected value changes;
  - `useMessage()` reads the current message inside `MessageList`.

  The actions are `send`, `setDraft`, `addFiles`, `removeFile`, `startDictation`, `finishDictation`, `cancelDictation`, `newConversation`, `rate` and `focus`.
- **Primitives** render one element each, with the existing `data-ask-part` name, and pass native props and `ref` through. The styling contract doesn't grow. There are two exceptions: `MessageList` renders its children once per message and has no element of its own, and `AttachButton` also renders its hidden file input.

  | Group | Primitives |
  |---|---|
  | Frame | `Theme`, `Panel` |
  | Messages | `Messages`, `MessageList`, `Message`, `MessageText`, `Markdown`, `Citations`, `MessageFiles`, `FeedbackButton` |
  | Message field | `Composer`, `Input`, `Send`, `AttachButton`, `Files`, `DictateButton`, `Recorder` |
  | Notices | `Status`, `ErrorMessage` |
- **`DefaultChat({ className?, headingLevel?, colorScheme?, onClose?, components? })`** is the widget's look, ready to place in a page. `components` replaces `Header`, `Welcome`, `Message` or `Footer`. These slots take no props and read what they need through the hooks.
- **`getChatConfig({ bots, bot, basePath?, locale? })`** in `@boldare/askdare/next` returns the `config` for `Root`.
  - It is synchronous and runs in a Server Component.
  - It can't come from `createChatHandler`, because a route file may export only handlers. The starter exports `basePath` from `askdare.config.ts` so the route and the page agree.
  - It reads asset names from a small generated module, so the page's server bundle doesn't pull in the inlined widget and fonts.
  - It can't know whether the route has `onFeedback`. The rating buttons show on answers that carry a feedback handle, and the server issues handles only when ratings are on.

### Server rendering and hydration

- `dist/react.js` starts with `'use client'`, and a test checks it.
- The server snapshot is fixed: phase `starting`, no messages, and the greeting and starters from the props. Storage, `navigator`, `matchMedia` and the network are touched only in `start()`, which runs in an effect.
- IDs come from `useId`, never from module-level counters.
- A test renders `DefaultChat` to HTML and hydrates it without mismatches.

### CSS

- **The stylesheet splits in two:**
  - `react/skin/askdare.css` is the skin. Its 57 `:root…` selectors become `[data-askdare-root]…`, with the same specificity. Its global rules (`*`, `button`, `:focus-visible`, reduced motion) go under `:where([data-askdare-root])`, which adds no specificity.
  - `widget-app/frame.css` keeps `html`, `body` and `#askdare-root`, which only the iframe has.
- **Inside the iframe, `<html>` stays the theme root.** It gets `data-askdare-root` next to the variant attributes. `:root` in `widget.css` and the attributes on `<html>` are public API (`docs/styling.md`), so they keep working, and the theme stylesheet and its hash don't change.
- **In a page, `Theme` is the root:** a `<div data-askdare-root>` with the variant attributes. It loads:
  - the tokens from `<basePath>/theme/<bot>.css?scope=inline`, where each scheme is a `[data-askdare-root][data-ask-scheme="…"]` block, so `colorScheme` can switch it. The bot's `widget.css` follows, with `:root` rewritten to `[data-askdare-root]`;
  - the fonts from the existing `fonts.<hash>.css`.

  `DefaultChat` also loads the skin from `<basePath>/assets/skin.<hash>.css`. The links use React 19's `precedence`, so nobody configures a bundler or imports CSS from the package. Ejected code imports its own copy of `askdare.css` instead.
- **Host resets can't break the skin.** The skin sets the browser defaults it relies on (lists, headings, paragraph margins) explicitly, at zero specificity. The docs say where to put the `askdare` layer in a Tailwind setup.
- **A guard test** fails when the skin has `:root`, `html`, `body` or an element selector outside `:where([data-askdare-root])`.

### Packaging

- **A third tsdown block** builds `react`:
  - for the browser platform, with the `'use client'` banner;
  - `react` stays external;
  - `marked` is bundled, so the XSS tests check exactly the version users run.
- **Types:** `tsconfig.react.json` with `isolatedDeclarations` and explicit export types.
- **`package.json`:** `exports["./react"]`, and an optional peer `react ^19`. The iframe build keeps Preact.
- **Checks:** the API snapshot and the no-leak check cover `react.d.ts`, and `types-test` gets a React consumer.
- **Size budgets** (gzipped):
  - `react.js` at most 32 KB;
  - a page that uses only `Root` and `useChat` at most 12 KB;
  - the iframe app still at most 50 KB.

### Security of a chat inside the page

The iframe isolated the chat from the host page (ADR-0005). Inside a page, that isolation is gone, so these rules apply. `THREAT_MODEL.md` gets the same section.
- **Same origin only.** The page and the chat route are one app. `Root` rejects a `basePath` that isn't a plain path, so it never talks to another origin. There is no CORS, and `assertSameOrigin` doesn't change.
- **The Markdown renderer is the only guard against XSS.** In a page there is no iframe CSP behind it. The renderer still produces only React elements, never HTML. The XSS test suite runs against the built `react.js`, Biome forbids `dangerouslySetInnerHTML`, and every change to the renderer gets a security review. Citation links go through the same `safeUrl` check as links in answers.
- **The page's scripts can see the chat.** Its tokens and messages live in the page's memory and storage. A site that runs scripts it doesn't trust should keep the iframe.
- **A page that passes `identity` must be dynamic and sent with `Cache-Control: no-store`,** because the token is in its HTML.
- **`getChatConfig` output is public.** It goes into the page's HTML, so it holds the same fields as the iframe's configuration and never the model, instructions, tools or vector stores.
- **The host's CSP must allow the chat:** `connect-src`, `style-src` and `font-src` for its own origin, `img-src blob:` for file previews, and `microphone=(self)` in `Permissions-Policy` for dictation. The docs list these.

### Eject

`npx @boldare/askdare add ui [--dir components/askdare]` copies the skin into the app, in the shadcn style.
- **The package ships the skin source.** `scripts/copy-ui.mjs` copies `src/react/skin/*` to `dist/ui/`, each file headed "Ejected from @boldare/askdare@x.y.z".
- **The skin imports only `@boldare/askdare/react` and its own files.** Biome enforces this, so the copy compiles in any app.
- **The command never overwrites a file.** After the eject, the app changes one import: the component is still called `DefaultChat`.
- **Proof in CI:**
  - `tsconfig.eject.json` type-checks `dist/ui` against `dist/react.d.ts` alone;
  - `verify-packs` runs `add ui` in a fresh app, builds a page with the ejected chat with Turbopack and with webpack, and sends a message.

## Consequences

- **New public API (ADR-0006):**
  - everything `@boldare/askdare/react` exports;
  - `getChatConfig`;
  - the `data-askdare-root` attribute;
  - the `add ui` command.

  The ejected files are the user's code, so later skin changes reach them only by hand. The changelog says when the skin changes.
- The primitives and the skin are one code base for the iframe and for pages, so a fix lands in both. The iframe stays on Preact, so the primitives must also compile with Preact 11: no `use()`, and `ref` as a prop is tested under both.
- React becomes an optional peer. 0.1 users who don't import `/react` see no change.
- A chat inside a page is as safe as the page. The docs say when to prefer the iframe.
- Visual baselines of the iframe must not change in any of these refactors. Inline pages get baselines of their own.

## Alternatives considered

- **A React component that renders the iframe.** It keeps the isolation, but users get no control over markup, which is the whole point of layers 4 and 5.
- **`export * as Chat` or a `Chat` object.** Namespace re-exports break in React Server Components, and dot access on an object fails across the `'use client'` boundary.
- **Shipping the skin CSS as a package export** (`import '@boldare/askdare/react/askdare.css'`). Every bundler handles CSS from `node_modules` differently, and the route already serves content-hashed assets. React's `precedence` links need no setup.
- **Shadow DOM for the chat inside a page.** It isolates CSS, but it breaks the page's fonts, focus handling, `useId`-based ARIA references and the host's own styling of the chat.
- **Building the iframe app on React.** It would weigh about 170 KB gzipped instead of 35, against the 50 KB budget.
- **`embedPath` and `toolRenderers` in 0.2.** Both are moved to 0.3, after the primitives prove themselves in pages.
