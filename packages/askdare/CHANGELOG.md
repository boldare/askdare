# @boldare/askdare

## 0.5.0

### Minor Changes

- 1b94b92: Built-in texts in Czech, German, Spanish, French and Italian, next to English and Polish. `widget.locale` set to one of these languages, or `'auto'` on a page or browser in one of them, now shows the chat and the launcher in that language with no `widget.texts` of your own. Your overrides still win. Other languages keep showing English.

### Patch Changes

- 8744972: New guide, `docs/compliance.md`: what the AI Act, the GDPR and the European Accessibility Act ask of a website chatbot, what askdare does about each, and the decisions left to you. It covers the AI disclosure, OpenAI's DPA, retention and deletion, `safety_identifier`, OpenAI's data residency (which doesn't cover the Conversations API askdare uses), the resume token in a chat inside your page, and hosts other than Vercel and Heroku (Docker, `next start`, OpenNext; no Edge runtime). It isn't legal advice.
- b5f3c44: A conversation that outgrows the model's context window now ends with "This conversation is too long. Please start a new one." (`invalid_input`, key `error.conversationTooLong`) instead of a generic "temporarily unavailable" error, should OpenAI ever refuse it. askdare keeps sending the deprecated `truncation: 'auto'` until OpenAI announces a shutdown date, so long conversations keep working as before.
- 6aacbb8: `askdare doctor` warns when OpenAI has announced a shutdown date for a bot's model or its transcription model, with the date from the OpenAI API and a link to OpenAI's deprecations page for the replacement.
- 08a1b01: A bot's `widget.css` can no longer reach the host page when the chat is inside a page. A stray `}` used to close the `@scope` block early, so a typo like `a { color: red } } body { display: none }` applied `body { display: none }` to the whole page. Stray closing braces are now dropped, and unclosed blocks or strings are closed, so every rule stays scoped to the chat.
- 0c0ccda: Server logs no longer risk carrying what a visitor wrote. When OpenAI rejects a request with a message that quotes the value it refused, or any other failure reaches the default error log (no `onError` set), quoted values longer than 32 characters are replaced, API keys are cut to their prefix and the message is capped at 300 characters. Status, error code, request ID and stack frames stay, so the logs remain useful for debugging.
- a190bcd: Streamed answers stay smooth however long they get: `Markdown` now re-lexes and re-renders only the last blocks of a message on each delta, instead of the whole answer. Sanitizing is unchanged.

## 0.4.0

### Minor Changes

- de9caf4: New route `GET <basePath>/config/<bot>?lang=<tag>`: the bot's public configuration in one language, built like the chat document's, so it never carries the model, instructions, tools or vector stores. It prepares switching the chat's language in place (ADR-0014, step 2). A bot with a fixed locale ignores `lang`, and an invalid tag answers `400` with `invalid_input`. Additive within protocol version 1.
- 82af455: A bot can show a page of your app in the widget's iframe instead of askdare's own (ADR-0018). Set `defineBot({ embedPath: '/askdare/support' })`, and the chat route redirects the iframe there with the visitor's language and the mode; the loader on the embedding sites doesn't change. `@boldare/askdare/next` adds `getEmbedConfig({ bots, bot, searchParams })`, the configuration for that page, and `embedPageHeaders({ bots, bot })`, the `frame-ancestors`, `Permissions-Policy` and `Referrer-Policy` headers it must send, to send from `proxy.ts`. `askdare doctor` follows the redirect and checks the page: no redirect in front of it, `EmbedRoot` on it, who may frame it and the microphone rule. The page renders the chat with `EmbedRoot` from `@boldare/askdare/embed`.
- 1e30933: Your own page in the widget's iframe (ADR-0018). A new entry, `@boldare/askdare/embed`, exports `EmbedRoot`: render it on the page a bot's `embedPath` points to, with `getEmbedConfig`, and put `DefaultChat`, an ejected copy or your own markup inside. It connects to the loader on the embedding site exactly as askdare's own page does (identity, `configure`, events, closing, language switches), so the widget on every site uses your components and draws your `toolRenderers`. Inside `EmbedRoot`, `DefaultChat` and an ejected copy of it own the document: an `h1` and a close button. A new hook, `useFrame()`, gives your own markup the same close action. The loader answers a new `askdare:hello` from its own iframe, so a page that hydrates after its load event still connects. Send the page's headers from `proxy.ts` with `embedPageHeaders`; the guide is in Embedding.
- e1fadd3: The chat switches its language in place (ADR-0014, step 2). When the page calls `askdare('configure', { locale })` or follows `<html lang>` with `data-follow-lang`, the chat no longer reloads: it fetches its texts for the new language from `GET <basePath>/config/<bot>` and keeps the conversation, the unsent message and an answer still streaming, which now finishes instead of being reported as `stopped`. New answers follow the new language. If the texts can't be loaded, the chat reloads as before. In React, a `Root` whose config changes only its `locale` switches the same chat instead of starting another one. `GET /config/<bot>` also answers `Content-Language`, the language its texts are written in.
- c994c50: A bot can give its texts per language: `widget.texts` also takes `{ en: {...}, pl: {...} }`, one set of overrides per language, so a chat with `locale: 'auto'` shows your own texts in each language (ADR-0014, step 2). A visitor gets the set for their language tag, else one for the same language; a language without a built-in dictionary gets the `en` set. The launcher on the page follows the same sets. A set's key wins over the `title`, `greeting`, `placeholder` and `launcherLabel` shortcuts for its language. The flat form is unchanged and still applies in every language. The chat document's `lang` follows a set written for the visitor's language.
- 3c7a2ca: Tool cards in the chat inside your page (ADR-0017). Give `Root` your components with `toolRenderers={{ find_slots: SlotList }}`, and the chat draws each tool's `ui` payload with its component under the answer, live and after a reload. A component gets `{ data, name, callId }`, typed from the tool with `ToolRendererProps<typeof findSlots>` and `import type`; `satisfies ToolRenderers<[typeof findSlots]>` checks the whole map. New primitives: `ToolResults` (parts `tool-results` and `tool-result`, with `data-ask-tool`), which `DefaultChat` places under the answer's text, and `Link`, which allows only `https`, `http` and `mailto` URLs from a payload. A tool without a component shows nothing, and a component that throws leaves out only its card. In the script-tag widget, a bot draws them when its iframe shows your own page (`embedPath` and `EmbedRoot`); askdare's own iframe page has no components to draw them with.
- 4ff33c4: Tools can pick what the visitor sees of their result (ADR-0017). `defineTool({ ui: (result) => data })` returns plain JSON of at most 8 KB for a card, list or table; only that reaches the browser, never the result itself. The server sends it as a new `tool.ui` event after the call (additive within protocol version 1), and `POST /history` brings every answer's payloads back as `ui` after a reload. At most 4 per answer, in call order; a failed call, a throwing `ui` or a payload over the limits shows nothing. `Tool` now carries the tool's name and payload type (`Tool<Name, Ui>`), so the React components that draw the payloads (`toolRenderers`) are typed from the tool. The browser keeps them on `ChatMessage.ui`.

### Patch Changes

- ca03828: Dependencies: `openai` ^7.56.0 (was ^7.52.0) and `jose` ^6.2.17 (was ^6.2.15). Nothing changes in askdare's API.
- 95fb6e2: The README's "What you get" picture now shows what 0.4 adds: tool cards, drawn by your own React components, your own page inside the widget, and texts per language.

## 0.3.0

### Minor Changes

- bca8d48: The chat can show clickable reply options under the latest answer ("Yes, book it", "Show prices"), in the widget and inside a page. A click sends the option as the visitor's own message. It adds a `replies` protocol event (additive in protocol version 1) with `replies` on the latest answer in the history, `ChatMessage.replies`, the `QuickReplies` primitive with the `replies` and `reply` parts, the theme variant `replies` (`answer` puts the options under the answer, `composer` puts them in one row above the message field), the `message.replies` text, and `source: 'reply'` on the `message.sent` chat event. Options are plain text: at most four, up to 80 characters each, without links. The model suggests options with `widget.replies: 'suggest'`, and a tool defines them with `defineTool({ replies })` (ADR-0015).
- 9fed4d3: A tool can offer clickable reply options derived from its result: `defineTool({ replies: (result) => ['Track the parcel', 'Talk to a person'] })`. `replies` gets the successful result as the model received it (parsed back from JSON) and is typed from `execute`; the options come back after a reload, from the stored call. The same limits as every reply option apply: at most four, up to 80 characters, plain text without links. Only the options reach the browser, never the tool's result (ADR-0015).
- 35ee326: The chat can switch language without a page load (ADR-0014, step 1). On a page with a bot set to `locale: 'auto'`, `askdare('configure', { locale: 'pl' })` or `data-follow-lang` on the script tag (which follows the page's `<html lang>`) switches the launcher's texts at once and reloads the chat in the new language. The visitor keeps their conversation; new answers follow the new language, as `context.locale` in your `instructions`. An answer still streaming during the switch is reported as `message.received` with `outcome: 'stopped'`, and the server still finishes and stores it. A bot with a fixed locale ignores the switch and says so once in the console. A `configure` call with only `locale` keeps the greeting, starters and context set before. In React, pass the new `locale` to `getChatConfig` as before.
- 7357c6f: Reply options suggested by the model (ADR-0015). With `widget.replies: 'suggest'`, a bot gets the built-in tool `suggest_replies`: the model can offer 2–4 short replies under an answer, which visitors click instead of typing. The server answers the call itself (no bot code runs), cleans the options up and sends them in the `replies` event; after a reload, the history brings back the options of the latest answer. When the model suggests them after its answer, the message ends without another model call; otherwise it takes one more. `suggest_replies` is now a reserved tool name. Off by default: it costs about 250 input tokens per model call, and sometimes a model call (docs/costs.md).

### Patch Changes

- 91e6826: The bundled docs no longer say that compaction comes in 0.3, or that `embedPath` and `toolRenderers` come in 0.3: compaction has no release yet, and the other two are planned for 0.4.
- d08bd22: The README's "What you get" picture now shows what 0.3 adds: clickable answers suggested by the model, reply options from your tools, switching the chat's language from the page, and the one-click deploy.
- 9cb8282: Reply options with characters the visitor can't see are dropped: zero-width and tag characters, direction marks, private-use and unassigned code points. A click sends an option as the visitor's own message, so it now always says exactly what they read. Emoji built with the zero-width joiner still work.

## 0.3.0-rc.1

### Patch Changes

- d08bd22: The README's "What you get" picture now shows what 0.3 adds: clickable answers suggested by the model, reply options from your tools, switching the chat's language from the page, and the one-click deploy.

## 0.3.0-rc.0

### Minor Changes

- bca8d48: The chat can show clickable reply options under the latest answer ("Yes, book it", "Show prices"), in the widget and inside a page. A click sends the option as the visitor's own message. This release adds the groundwork: a `replies` protocol event (additive in protocol version 1) with `replies` on the latest answer in the history, `ChatMessage.replies`, the `QuickReplies` primitive with the `replies` and `reply` parts, the theme variant `replies` (`answer` puts the options under the answer, `composer` puts them in one row above the message field), the `message.replies` text, and `source: 'reply'` on the `message.sent` chat event. Options are plain text: at most four, up to 80 characters each, without links. Model-suggested and tool-defined options, which fill them, come in later releases (ADR-0015).
- 9fed4d3: A tool can offer clickable reply options derived from its result: `defineTool({ replies: (result) => ['Track the parcel', 'Talk to a person'] })`. `replies` gets the successful result as the model received it (parsed back from JSON) and is typed from `execute`; the options come back after a reload, from the stored call. The same limits as every reply option apply: at most four, up to 80 characters, plain text without links. Only the options reach the browser, never the tool's result (ADR-0015).
- 35ee326: The chat can switch language without a page load (ADR-0014, step 1). On a page with a bot set to `locale: 'auto'`, `askdare('configure', { locale: 'pl' })` or `data-follow-lang` on the script tag (which follows the page's `<html lang>`) switches the launcher's texts at once and reloads the chat in the new language. The visitor keeps their conversation; new answers follow the new language, as `context.locale` in your `instructions`. An answer still streaming during the switch is reported as `message.received` with `outcome: 'stopped'`, and the server still finishes and stores it. A bot with a fixed locale ignores the switch and says so once in the console. A `configure` call with only `locale` keeps the greeting, starters and context set before. In React, pass the new `locale` to `getChatConfig` as before.
- 7357c6f: Reply options suggested by the model (ADR-0015). With `widget.replies: 'suggest'`, a bot gets the built-in tool `suggest_replies`: the model can offer 2–4 short replies under an answer, which visitors click instead of typing. The server answers the call itself (no bot code runs), cleans the options up and sends them in the `replies` event; after a reload, the history brings back the options of the latest answer. When the model suggests them after its answer, the message ends without another model call; otherwise it takes one more. `suggest_replies` is now a reserved tool name. Off by default: it costs about 250 input tokens per model call, and sometimes a model call (docs/costs.md).

### Patch Changes

- 9cb8282: Reply options with characters the visitor can't see are dropped: zero-width and tag characters, direction marks, private-use and unassigned code points. A click sends an option as the visitor's own message, so it now always says exactly what they read. Emoji built with the zero-width joiner still work.

## 0.2.0

### Minor Changes

- 1a1659f: New command `npx @boldare/askdare add ui`: copies the source of the chat's default look (React components and their stylesheet) into `components/askdare`, or the folder given with `--dir`, so you can change it freely. It never overwrites files. The copy imports only `@boldare/askdare/react`, and you switch to it by changing one import of `DefaultChat`.
- ac878e6: The page can now hear what happens in the chat, for analytics such as GA4 or a GTM `dataLayer`: `askdare('on', type, listener)` with the script tag, or `onEvent` on `Root` in React. Events cover the chat opening and closing, messages sent, answers received, ratings, errors and starting over. They carry metadata only, such as counts, durations and outcomes, and never message text. See the "Chat events" guide (ADR-0013).
- 9bd1b16: Visitors' ratings of answers reach `createChatHandler({ onFeedback })`: 👍, 👎 with an optional comment, or the rating taken back, with the conversation and answer IDs for your own review. Each answer carries an encrypted rating handle in `message.end` and in the history, bound to the visitor or signed-in user, and `POST /feedback` accepts a rating only from them. A bot turns ratings off with `widget.feedback: false`. askdare stores no ratings.
- 05076dc: The chat shows 👍 and 👎 under each answer when `createChatHandler` has `onFeedback`. After a 👎 it asks "What went wrong?" with an optional comment, a second click takes a rating back, and the browser remembers the visitor's ratings across reloads. New text keys `feedback.*` (English and Polish) and parts `feedback`, `feedback-button`, `feedback-comment` and its children. In your own React markup, use `FeedbackButton` and `actions.rate`. See the new Answer ratings guide.
- d789913: The config that `npx @boldare/askdare init` writes now reads three optional environment variables. `ASKDARE_INSTRUCTIONS` and `ASKDARE_GREETING` replace the bot's default instructions and greeting, and `ASKDARE_ALLOWED_ORIGINS` lists the other sites that may embed the chat, comma-separated. Blank values fall back to the defaults, and trailing slashes are dropped from origins. Without the variables the bot behaves as before. The starter's Vercel button asks for the instructions and greeting, and its Heroku `app.json` offers all three.
- 48ddabf: New entry `@boldare/askdare/react`: the chat inside a page of your own Next.js app, without an iframe. `Root` runs one bot's chat, `DefaultChat` is the widget's look ready to place, and the hooks (`useChat`, `useChatState`, `useMessage`) and primitives (`Messages`, `MessageList`, `Message`, `MessageText`, `Composer`, `Input`, `Send` and the rest) let you write your own markup on the same parts and tokens. `getChatConfig({ bots, bot })` from `@boldare/askdare/next` gives a Server Component the public configuration to pass to `Root`. React 19 is a new optional peer dependency; the script-tag widget needs nothing new. The chat talks only to its own origin, and a page that renders it shares its scripts' access to the conversation: on sites that run scripts they don't trust, keep the iframe widget.
- 94a1e30: `createChatHandler({ onUsage })` reports every chat turn once its answer has streamed, failed turns included: the tokens it used (input, cached and cache-write input, output and reasoning), the model that answered, how long it took and which tools it called, with pseudonyms instead of IDs and never any message text. Use it for cost tracking and tracing. `onError` may now be async too, and a hook that throws no longer reaches the request: askdare logs its error's name instead.

### Patch Changes

- 7c9fb36: Source links under an answer are checked like links inside it: only `http`, `https` and `mailto` URLs become links, and anything else shows as plain text. Before, they relied on the protocol validator alone.
- 66da550: The README links to askdare.vercel.app/deploy, where the one-click deploy of the starter takes about five minutes.
- c0c1a7f: docs: the one-click deploy takes about five minutes, and askdare.vercel.app/deploy makes the `CHAT_SECRET` for the Vercel form.
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
- 9540d46: The README's "What you get" picture now shows what 0.2 adds: the chat inside your own page with React, ratings of answers, observability with OpenTelemetry, and chat events for analytics.
- 1c45e8a: With reduced motion, the launcher icon no longer turns as it swaps between chat and close.
- 8608d69: Starting a new conversation now shows that it is working: the question stays open while the old conversation is deleted, with its icon turning and its buttons waiting. Before, nothing visible happened until the server answered.
- 8d81c46: The floating chat opens with a livelier animation and now animates out when it closes; the launcher icon turns between chat and close, and phones slide the full-screen chat up. Reduced motion still turns all of it off.
- eb7b7aa: The chat window is built with Preact 11.2. It looks and works the same.

## 0.2.0-rc.3

### Patch Changes

- 66da550: The README links to askdare.vercel.app/deploy, where the one-click deploy of the starter takes about five minutes.
- c0c1a7f: docs: the one-click deploy takes about five minutes, and askdare.vercel.app/deploy makes the `CHAT_SECRET` for the Vercel form.
- 1c45e8a: With reduced motion, the launcher icon no longer turns as it swaps between chat and close.

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
