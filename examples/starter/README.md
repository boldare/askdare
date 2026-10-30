# askdare starter

A minimal Next.js app with an [askdare](https://www.npmjs.com/package/@boldare/askdare) chat: one bot, one route and one script tag. It is exactly what `npx @boldare/askdare init` adds to a fresh `create-next-app`.

<!-- Deploy to Vercel button: add it once the repository is public. -->

## Start

1. Create the app:

   ```bash
   npx create-next-app --example https://github.com/boldare/askdare/tree/main/examples/starter my-chat
   ```

2. Copy `.env.example` to `.env.local` and fill it in:
   - `OPENAI_API_KEY`: a key from a dedicated OpenAI project with a hard spend limit.
   - `CHAT_SECRET`: at least 32 random characters. The command in `.env.example` generates one.
   - `ASKDARE_MODEL`: a current OpenAI model your project may use.
3. Run `npm run dev` and open <http://localhost:3000>. The chat button is in the bottom-right corner.
4. In a second terminal, check the setup:

   ```bash
   npx @boldare/askdare doctor
   ```

## What is where

| File | What it does |
| --- | --- |
| `askdare.config.ts` | The bot: model, instructions, the sites that may embed it, its look. |
| `app/api/chat/[...path]/route.ts` | The chat's API, script and iframe. `maxDuration` must stay a literal in this file. |
| `app/layout.tsx` | Loads the chat on every page with `next/script`. |
| `AGENTS.md` | Points AI coding agents to the askdare docs that match the installed version. |

The guides are in `node_modules/@boldare/askdare/docs/`: knowledge base, tools, attachments, voice input, styling, themes, identity, deployment and going public.

## Deploy

**Vercel:**

1. Import the repository.
2. Under **Settings → Environment Variables**, add `OPENAI_API_KEY`, `CHAT_SECRET` and `ASKDARE_MODEL` for Production and for Preview. Without `ASKDARE_MODEL` the build fails.

**Heroku:**

1. Add a `Procfile`. The longer keep-alive outlasts Heroku's router, so answers aren't cut off:

   ```text
   web: next start --port $PORT --keepAliveTimeout 95000
   ```

2. Set the same variables under **Settings → Config Vars**.

Limits are counted in each instance's memory. With more than one instance, add `@boldare/askdare-upstash` so they share them. The full steps are in `node_modules/@boldare/askdare/docs/deployment.md`; before the chat goes public, work through `going-public.md` next to it.

## Embed the chat on another site

Add the site to `security.allowedOrigins` in `askdare.config.ts`, then paste this into its pages:

```html
<script src="https://<your app>/api/chat/widget.js?bot=support" async></script>
```
