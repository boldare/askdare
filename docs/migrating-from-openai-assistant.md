# Migrating from @boldare/openai-assistant

`@boldare/openai-assistant` stopped working on 2026-08-26, when OpenAI shut down the Assistants API it was built on. askdare is its successor from the same team, but not a new version of it: the old library was a NestJS module with an Angular widget, and askdare is a Next.js library on the Responses API. There is no upgrade in place. You move your assistant's setup into a Next.js app instead.

Most deployments take an afternoon. The assistant's instructions, its tools and its knowledge files carry over. Old conversations don't: they lived in Assistants API threads, which can no longer be read.

## What maps to what

| openai-assistant 1.x | askdare |
|---|---|
| `AssistantModule.forRoot(config)` in a NestJS app, plus `ASSISTANT_ID` | `defineBot({...})` in `askdare.config.ts`, served by `createChatHandler({ bots })` from one Next.js route. There is no assistant object at OpenAI to create or keep in sync. |
| Agents extending `AgentBase`, with arguments as a raw JSON string | `defineTool` with a Zod schema. Arguments are validated before your code runs, and each call has a timeout. See [Tools](tools.md). |
| Threads, `ThreadsController` | Conversations in the OpenAI Conversations API. The visitor's browser keeps only a signed token. No database. |
| socket.io `ChatGateway`, raw Assistants stream events | Server-sent events over `POST`, in askdare's own versioned [protocol](protocol.md). |
| Run polling | Streaming Responses API calls, with limits on tool steps and a deadline per turn. |
| Knowledge files uploaded at startup, `.env` rewritten at runtime | `npx @boldare/askdare kb sync <folder>`, run when the files change. It prints the vector store ID once; the app only reads `KB_VECTOR_STORE_ID`. See [Knowledge base](knowledge-base.md). |
| `FilesController` | Image and PDF attachments, checked by file type and size, and referenced by signed handles. See [Attachments](attachments.md). |
| `whisper-1` speech to text | Voice input with a transcription model you choose. See [Voice input](voice-input.md). |
| `tts-1` text to speech | Not available. OpenAI is retiring its text-to-speech models. |
| Annotations resolved with a file lookup per citation | Citations with a title and a link to your page, set by `kb sync`. |
| The `ai-embedded` iframe and its `postMessage` | One `<script>` tag. The chat runs in an iframe that only the sites in `allowedOrigins` may embed. See [Embedding](embedding.md). |
| Angular widget configured at build time | Widget settings in `defineBot({ widget })`: four themes, English and Polish texts, your own CSS. See [Styling](styling.md) and [Themes](themes.md). |
| No sign-in, CORS open to every origin | Short-lived session tokens, rate limits, daily token budgets and an origin allowlist by default. See [Going public](going-public.md). |

## Steps

1. **Pick the Next.js app** that will serve the chat: an existing Next.js 16 app with the App Router, or a new one from the [starter](https://github.com/boldare/askdare/tree/main/examples/starter). Your other sites embed the chat from there, so it needn't be the site visitors see.
2. **Add askdare** as [Getting started](getting-started.md) describes: `npm install @boldare/askdare zod`, then `npx @boldare/askdare init`.
3. **Move the assistant's setup** into `askdare.config.ts`:
   - your instructions go into `instructions`;
   - the model goes into `ASKDARE_MODEL`. Pick a current one: the models your old assistant used may be retired;
   - the greeting, starter questions and colors go into `widget`.
4. **Rewrite each agent as a tool.** The handler body usually stays as it is. Replace the JSON string parsing with a Zod schema, and return a plain object instead of a string. Read the [Tools](tools.md) guide first: a tool must never trust IDs that the model chose.
5. **Sync the knowledge files:** `npx @boldare/askdare kb sync <folder>`, then set `KB_VECTOR_STORE_ID`. Add a `url` per file if citations should link to your pages.
6. **Replace the embed code** on your sites with the askdare script tag, and list those sites in `security.allowedOrigins`.
7. **Check and deploy.** `npx @boldare/askdare doctor` checks the key, the model and the headers. [Deployment](deployment.md) covers Vercel and Heroku.
8. **Remove the old service** and its NestJS module. Delete the old assistant's files and vector stores in the OpenAI dashboard if you no longer need them.

## What you lose

- **Old conversations.** Threads from the Assistants API can't be read any more, so there is nothing to import.
- **Text to speech.** Answers are text. Dictation (speech to text) is still there.
- **Assistants edited in the OpenAI dashboard.** Instructions now live in your code, so they are versioned and reviewed like the rest of it.
