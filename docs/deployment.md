# Deployment

askdare runs wherever Next.js runs on Node.js. It needs no database: conversations live in OpenAI, and your app only stores signed tokens in the visitor's browser. These are the steps for Vercel and Heroku. Before the chat is public, also work through the [going-public checklist](going-public.md).

## What every deployment needs

| Variable | Notes |
|---|---|
| `OPENAI_API_KEY` | A key from the OpenAI project for **this** environment. Use separate projects for development and production. |
| `CHAT_SECRET` | A new secret per environment: `openssl rand -base64 32`. Don't reuse the one from `.env.local`. |
| `ASKDARE_MODEL` | If your config reads the model from it, as the `init` template does. |
| `IDENTITY_SECRET` | Only for [signed-in visitors](identity.md). Shared with your site's backend, different from `CHAT_SECRET`. |
| `KB_VECTOR_STORE_ID` | Only with a knowledge base. Vector stores belong to one OpenAI project, so run `kb sync` with the production key to get the production store. |

Set them in your host's settings, never in files you commit.

## Vercel

1. Import the repository in Vercel. The defaults for Next.js are right.
2. Add the variables above under **Settings → Environment Variables**, for Production and Preview. `next build` fails without `ASKDARE_MODEL`, so every environment that builds the app needs it. `vercel env pull .env.local` copies the development values to your machine.
3. **Share the rate limits.** Vercel runs many instances at once, and the default limits are kept per instance. Create a Redis database at [Upstash](https://upstash.com/) (also available in the Vercel Marketplace) and use the add-on:

   ```bash
   npm install @boldare/askdare-upstash
   ```

   ```ts
   // app/api/chat/[...path]/route.ts
   import { upstashStore } from '@boldare/askdare-upstash';

   export const { GET, POST, DELETE } = createChatHandler({
     bots,
     limits: { store: upstashStore() }, // UPSTASH_REDIS_REST_URL and _TOKEN, or KV_REST_API_URL and _TOKEN
   });
   ```

4. Keep `export const maxDuration = 300` in the route file. That is the longest a streamed answer may take; each bot's `limits.turnTimeoutMs` (120 s by default) must stay below it.
5. Deploy, then check the live app:

   ```bash
   npx @boldare/askdare doctor --url https://your-app.vercel.app --env-file .env.production.local
   ```

   `doctor` signs its request with `CHAT_SECRET`, so the file must hold the production secret. Keep it out of git; `init` already ignores `.env*.local`.

Requests to Vercel functions can be at most 4.5 MB, so keep `attachments.maxBytes` at its default of 4 MB or lower.

## Heroku

1. Create the app and set the Node.js version in `package.json`:

   ```json
   { "engines": { "node": "24.x" } }
   ```

2. Add a `Procfile`. The longer keep-alive outlasts Heroku's router, so connections aren't cut mid-answer:

   ```text
   web: next start --port $PORT --keepAliveTimeout 95000
   ```

3. Set the variables above under **Settings → Config Vars** in the dashboard. Typing the key into `heroku config:set` would leave it in your shell history.
4. **One dyno** works with the default limits. With more dynos, share the limits with `@boldare/askdare-upstash`, as for Vercel.
5. Deploy, then check it:

   ```bash
   npx @boldare/askdare doctor --url https://your-app.herokuapp.com --env-file .env.production.local
   ```

Heroku closes a request that sends nothing for 30 seconds at first, and 55 seconds after that. askdare sends the first byte at once and a heartbeat every 15 seconds, so slow answers survive.

## Behind another proxy or CDN

- Don't buffer `text/event-stream` responses; askdare sends `X-Accel-Buffering: no` for nginx.
- Each proxy adds itself to `X-Forwarded-For`. With more than the host's own proxy in front of the app, set `limits.trustProxy` in `createChatHandler` to the number of proxies, or per-IP limits count the proxy instead of the visitor.
- Leave `/api/chat` out of `proxy.ts`, of `headers()` in `next.config`, and of any CDN rule that sets `X-Frame-Options`, a Content Security Policy or cookies. `doctor` reports each of these.
