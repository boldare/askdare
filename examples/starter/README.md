# askdare starter

A minimal Next.js app with an [askdare](https://www.npmjs.com/package/@boldare/askdare) chat: one bot, one route and one script tag. It is exactly what `npx @boldare/askdare init` adds to a fresh `create-next-app`.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fboldare%2Faskdare%2Ftree%2Fmain%2Fexamples%2Fstarter&project-name=askdare-chat&repository-name=askdare-chat&env=OPENAI_API_KEY%2CCHAT_SECRET%2CASKDARE_MODEL&envDefaults=%7B%22ASKDARE_MODEL%22%3A%22gpt-6.1-terra%22%7D&envDescription=OPENAI_API_KEY%3A%20a%20key%20from%20a%20dedicated%20OpenAI%20project%20with%20a%20hard%20spend%20limit.%20CHAT_SECRET%3A%20at%20least%2032%20random%20characters%2C%20for%20example%20from%20node%20-e%20%22console.log%28require%28%27node%3Acrypto%27%29.randomBytes%2832%29.toString%28%27base64url%27%29%29%22.%20ASKDARE_MODEL%3A%20a%20current%20OpenAI%20model%20your%20project%20may%20use.&envLink=https%3A%2F%2Faskdare.vercel.app%2Fdocs%2Fdeployment%23one-click-deploy)

The button copies this starter into a new repository on your Git account and deploys it to Vercel. It asks for the three variables in [Start](#start). Heroku works from your own copy; see [Deploy](#deploy).

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
| `app.json`, `Procfile` | Deploy metadata for Heroku. `init` doesn't add them; delete them if you don't use Heroku. |

The guides are in `node_modules/@boldare/askdare/docs/`: knowledge base, tools, attachments, voice input, styling, themes, the chat inside your page (React), answer ratings, observability, identity, deployment and going public.

## Deploy

**Vercel:** import your copy of the repository, or use the button at the top for a new one. The variables go under **Settings → Environment Variables**, for Production and for Preview (the button sets them for you). Without `ASKDARE_MODEL` the build fails.

**Heroku:** `app.json` and `Procfile` set the app up. Push your copy to GitHub, then open `https://www.heroku.com/deploy?template=https://github.com/<you>/<repo>`. Heroku asks for `OPENAI_API_KEY`, generates `CHAT_SECRET`, fills in `ASKDARE_MODEL` and runs one web dyno. The `Procfile`'s longer keep-alive outlasts Heroku's router, so answers aren't cut off.

Then check the live app with the production values, from your copy:

```bash
npx @boldare/askdare doctor --url https://<your app> --env-file .env.production.local
```

Limits are counted in each instance's memory. With more than one instance, add `@boldare/askdare-upstash` so they share them. The full steps are in `node_modules/@boldare/askdare/docs/deployment.md`; before the chat goes public, work through `going-public.md` next to it.

## Embed the chat on another site

Add the site to `security.allowedOrigins` in `askdare.config.ts`, then paste this into its pages:

```html
<script src="https://<your app>/api/chat/widget.js?bot=support" async></script>
```
