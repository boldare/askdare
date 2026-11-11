# @boldare/askdare

## 0.2.0-rc.2

### Minor Changes

- ac878e6: The page can now hear what happens in the chat, for analytics such as GA4 or a GTM `dataLayer`: `askdare('on', type, listener)` with the script tag, or `onEvent` on `Root` in React. Events cover the chat opening and closing, messages sent, answers received, ratings, errors and starting over. They carry metadata only, such as counts, durations and outcomes, and never message text. See the "Chat events" guide (ADR-0013).
- d789913: The config that `npx @boldare/askdare init` writes now reads three optional environment variables. `ASKDARE_INSTRUCTIONS` and `ASKDARE_GREETING` replace the bot's default instructions and greeting, and `ASKDARE_ALLOWED_ORIGINS` lists the other sites that may embed the chat, comma-separated. Blank values fall back to the defaults, and trailing slashes are dropped from origins. Without the variables the bot behaves as before. The starter's Vercel button asks for the instructions and greeting, and its Heroku `app.json` offers all three.

### Patch Changes

- 9540d46: The README's "What you get" picture now shows what 0.2 adds: the chat inside your own page with React, ratings of answers, observability with OpenTelemetry, and chat events for analytics.
- 8608d69: Starting a new conversation now shows that it is working: the question stays open while the old conversation is deleted, with its icon turning and its buttons waiting. Before, nothing visible happened until the server answered.
- 8d81c46: The floating chat opens with a livelier animation and now animates out when it closes; the launcher icon turns between chat and close, and phones slide the full-screen chat up. Reduced motion still turns all of it off.

## 0.2.0-rc.1

### Patch Changes

- eb7b7aa: The chat window is built with Preact 11.2. It looks and works the same.

## 0.2.0-rc.0

### Minor Changes

- 1a1659f: New command `npx @boldare/askdare add ui`: copies the source of the chat's default look (React components and their stylesheet) into `components/askdare`, or the folder given with `--dir`, so you can change it freely. It never overwrites files. The copy imports only `@boldare/askdare/react`, and you switch to it by changing one import of `DefaultChat`.
- 9bd1b16: Visitors' ratings of answers reach `createChatHandler({ onFeedback })`: 👍, 👎 with an optional comment, or the rating taken back, with the conversation and answer IDs for your own review. Each answer carries an encrypted rating handle in `message.end` and in the history, bound to the visitor or signed-in user, and `POST /feedback` accepts a rating only from them. A bot turns ratings off with `widget.feedback: false`. askdare stores no ratings.
- 05076dc: The chat shows 👍 and 👎 under each answer when `createChatHandler` has `onFeedback`. After a 👎 it asks "What went wrong?" with an optional comment, a second click takes a rating back, and the browser remembers the visitor's ratings across reloads. New text keys `feedback.*` (English and Polish) and parts `feedback`, `feedback-button`, `feedback-comment` and its children. In your own React markup, use `FeedbackButton` and `actions.rate`. See the new Answer ratings guide.
- 48ddabf: New entry `@boldare/askdare/react`: the chat inside a page of your own Next.js app, without an iframe. `Root` runs one bot's chat, `DefaultChat` is the widget's look ready to place, and the hooks (`useChat`, `useChatState`, `useMessage`) and primitives (`Messages`, `MessageList`, `Message`, `MessageText`, `Composer`, `Input`, `Send` and the rest) let you write your own markup on the same parts and tokens. `getChatConfig({ bots, bot })` from `@boldare/askdare/next` gives a Server Component the public configuration to pass to `Root`. React 19 is a new optional peer dependency; the script-tag widget needs nothing new. The chat talks only to its own origin, and a page that renders it shares its scripts' access to the conversation: on sites that run scripts they don't trust, keep the iframe widget.
- 94a1e30: `createChatHandler({ onUsage })` reports every chat turn once its answer has streamed, failed turns included: the tokens it used (input, cached and cache-write input, output and reasoning), the model that answered, how long it took and which tools it called, with pseudonyms instead of IDs and never any message text. Use it for cost tracking and tracing. `onError` may now be async too, and a hook that throws no longer reaches the request: askdare logs its error's name instead.

### Patch Changes

- 7c9fb36: Source links under an answer are checked like links inside it: only `http`, `https` and `mailto` URLs become links, and anything else shows as plain text. Before, they relied on the protocol validator alone.
- 45ef7de: Fixes in the chat inside a page and its default look:
  
  - An answer or a transcript returns focus to the message field only when focus was in the chat or nowhere, never from the page's own fields, and without scrolling the page. `actions.focus()` still always moves it.
  - Ratings of one answer go out one at a time: quick 👍 then 👎 ends with what the server took, and a failed one goes back to the last rating it confirmed.
  - A comment after 👎 stays in its form until it is sent, so a failed send no longer loses the text.
  - No new dictation starts while the last one is being transcribed.
  - `<Root>` unmounting stops the answer being streamed and the uploads still running.
  - `Composer`: an `onSubmit` that calls `preventDefault()` takes the message over, Enter in the `Input` goes through `onSubmit` too, and an `onPaste` that prevents the default keeps the files out.
  - Escape outside the chat is left to the page also with `headingLevel={1}`, and Escape that a handler already used is ignored. The question before a new conversation is modal only in the iframe.
  - The default look's stylesheet styles only the chat inside `DefaultChat`, never a headless chat in the same document.
  - The rating buttons and the question after 👎 scroll into view at the end of the conversation, and messages no longer re-render on every change of the chat.

## 0.1.0

### Minor Changes

- da333a2: First release of askdare: an AI chat for any website, served by your Next.js app and built on the official OpenAI SDK (Responses and Conversations APIs). It succeeds `@boldare/openai-assistant`, which stopped working when OpenAI shut down the Assistants API.
  
  - **Integration:** a bot in `askdare.config.ts` (`defineBot`), one catch-all route (`createChatHandler`) and one script tag on any website (`widget.js?bot=<id>`). `npx @boldare/askdare init` sets it up, and `npx @boldare/askdare doctor` checks the key, models, vector store, headers and allowed sites, locally or deployed.
  - **Embedding:** a small loader and an isolated iframe served by your app, shown only on the sites in `security.allowedOrigins`. As a bubble, behind your own button (`data-launcher="none"`) or inside the page (`data-mode="inline"`), driven by `askdare('open' | 'close' | 'toggle' | 'configure' | 'identify')`.
  - **No database:** conversations live in OpenAI's Conversations API, and the browser keeps an encrypted resume token. Visitors can start a new conversation, which deletes the old one and its files.
  - **Knowledge base:** `npx @boldare/askdare kb sync <folder>` mirrors your documents to a vector store, and answers cite your pages.
  - **Tools:** `defineTool` with Zod schemas, validated arguments, timeouts and output limits. Tools see only verified context.
  - **Attachments and voice:** images and PDFs (checked by their bytes, re-encoded in the browser, referenced by encrypted handles), and dictation into the message field.
  - **Signed-in visitors:** `askdare('identify', token)` with a JWT your backend signs.
  - **Safety and cost:** short-lived encrypted sessions; rate limits; daily token and speech budgets per visitor, IP, bot and app, reserved per model call; a kill switch; sanitized Markdown; no cookies; no message content in logs; `onError` for your monitoring. In development, the chat and the log say what is wrong with the setup.
  - **Look:** four themes (Aura, Halo, Sage, Care) in light and dark, your own with `defineTheme`, `--ask-*` tokens and `data-ask-part` parts for your CSS, English and Polish texts with overrides for every key, and an AI disclosure. Keyboard, focus and screen reader support, checked with axe.
  - **Docs in the package:** the guides (`docs/`), `llms.txt` and a skill for AI coding agents (`skills/askdare`), always matching the installed version.
  
  For limits shared across several server instances, add `@boldare/askdare-upstash`.

### Patch Changes

- 3bf0dd0: Requires `openai` 7.52.0 and `jose` 6.2.15 or newer. Nothing changes in how askdare calls the API or signs tokens.
- ef92f7a: Closing the chat from inside it returns keyboard focus to the page in Firefox too, not only in Chromium. `doctor` and `init` no longer report `.env.local` as not ignored in a project without git when its `.gitignore` has folder negations such as `!.yarn/patches`, as create-next-app's does.
- 13259d4: When the chat opens with a stored conversation and the server refuses the session, it shows the server's reason (explained in development) instead of "Could not load the previous conversation." The conversation stays stored for the next try.
- 4b7512b: The launcher's label is a part, `launcher-label`, so a site can hide it on small screens and show only the orb or picture (see Styling). A chat placed in the page (`data-mode="inline"`) no longer sits above the page's own fixed elements, such as a sticky header or a bottom bar.
- 342a931: Requires the `openai` SDK 7.51.0 or newer (was 7.45.1). Nothing changes in how askdare calls the API.
- 9d4a548: The README is shorter, with three steps to a working chat and a map of the guides. Getting started explains how AI coding agents use the docs and the skill in the package.
- f25bb19: Docs: a database from the Vercel Marketplace (Upstash for Redis) sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and one from the Upstash console has the `UPSTASH_REDIS_REST_*` names. The store reads both, as before.
- 68d94e6: The npm pages link to the website, https://askdare.vercel.app, with the docs and a live demo of every theme.
- 4b9cfed: The chat window is built with Preact 11. It looks and works the same.

## 0.1.0-rc.4

### Patch Changes

- 3bf0dd0: Requires `openai` 7.52.0 and `jose` 6.2.15 or newer. Nothing changes in how askdare calls the API or signs tokens.
- 9d4a548: The README is shorter, with three steps to a working chat and a map of the guides. Getting started explains how AI coding agents use the docs and the skill in the package.
- 4b9cfed: The chat window is built with Preact 11. It looks and works the same.

## 0.1.0-rc.3

### Patch Changes

- 4b7512b: The launcher's label is a part, `launcher-label`, so a site can hide it on small screens and show only the orb or picture (see Styling). A chat placed in the page (`data-mode="inline"`) no longer sits above the page's own fixed elements, such as a sticky header or a bottom bar.
- 342a931: Requires the `openai` SDK 7.51.0 or newer (was 7.45.1). Nothing changes in how askdare calls the API.

## 0.1.0-rc.2

### Patch Changes

- f25bb19: Docs: a database from the Vercel Marketplace (Upstash for Redis) sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and one from the Upstash console has the `UPSTASH_REDIS_REST_*` names. The store reads both, as before.
- 68d94e6: The npm pages link to the website, https://askdare.vercel.app, with the docs and a live demo of every theme.

## 0.1.0-rc.1

### Patch Changes

- 13259d4: When the chat opens with a stored conversation and the server refuses the session, it shows the server's reason (explained in development) instead of "Could not load the previous conversation." The conversation stays stored for the next try.

## 0.1.0-rc.0

### Minor Changes

- da333a2: First release of askdare: an AI chat for any website, served by your Next.js app and built on the official OpenAI SDK (Responses and Conversations APIs). It succeeds `@boldare/openai-assistant`, which stopped working when OpenAI shut down the Assistants API.
  
  - **Integration:** a bot in `askdare.config.ts` (`defineBot`), one catch-all route (`createChatHandler`) and one script tag on any website (`widget.js?bot=<id>`). `npx @boldare/askdare init` sets it up, and `npx @boldare/askdare doctor` checks the key, models, vector store, headers and allowed sites, locally or deployed.
  - **Embedding:** a small loader and an isolated iframe served by your app, shown only on the sites in `security.allowedOrigins`. As a bubble, behind your own button (`data-launcher="none"`) or inside the page (`data-mode="inline"`), driven by `askdare('open' | 'close' | 'toggle' | 'configure' | 'identify')`.
  - **No database:** conversations live in OpenAI's Conversations API, and the browser keeps an encrypted resume token. Visitors can start a new conversation, which deletes the old one and its files.
  - **Knowledge base:** `npx @boldare/askdare kb sync <folder>` mirrors your documents to a vector store, and answers cite your pages.
  - **Tools:** `defineTool` with Zod schemas, validated arguments, timeouts and output limits. Tools see only verified context.
  - **Attachments and voice:** images and PDFs (checked by their bytes, re-encoded in the browser, referenced by encrypted handles), and dictation into the message field.
  - **Signed-in visitors:** `askdare('identify', token)` with a JWT your backend signs.
  - **Safety and cost:** short-lived encrypted sessions; rate limits; daily token and speech budgets per visitor, IP, bot and app, reserved per model call; a kill switch; sanitized Markdown; no cookies; no message content in logs; `onError` for your monitoring. In development, the chat and the log say what is wrong with the setup.
  - **Look:** four themes (Aura, Halo, Sage, Care) in light and dark, your own with `defineTheme`, `--ask-*` tokens and `data-ask-part` parts for your CSS, English and Polish texts with overrides for every key, and an AI disclosure. Keyboard, focus and screen reader support, checked with axe.
  - **Docs in the package:** the guides (`docs/`), `llms.txt` and a skill for AI coding agents (`skills/askdare`), always matching the installed version.
  
  For limits shared across several server instances, add `@boldare/askdare-upstash`.
