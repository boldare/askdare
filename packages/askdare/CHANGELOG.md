# @boldare/askdare

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
