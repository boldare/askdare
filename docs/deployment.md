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

## One-click deploy

To see askdare running on a host before you add it to your own app, deploy the [starter](https://github.com/boldare/askdare/tree/main/examples/starter): the app that `npx @boldare/askdare init` makes of a fresh `create-next-app`, with one bot.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fboldare%2Faskdare%2Ftree%2Fmain%2Fexamples%2Fstarter&project-name=askdare-chat&repository-name=askdare-chat&env=OPENAI_API_KEY%2CCHAT_SECRET%2CASKDARE_MODEL%2CASKDARE_INSTRUCTIONS%2CASKDARE_GREETING&envDefaults=%7B%22ASKDARE_MODEL%22%3A%22gpt-6.1-terra%22%2C%22ASKDARE_INSTRUCTIONS%22%3A%22You%20are%20the%20assistant%20on%20our%20website.%20Answer%20briefly%20and%20politely.%20If%20you%20do%20not%20know%20something%2C%20say%20so.%22%2C%22ASKDARE_GREETING%22%3A%22Hi%21%20How%20can%20I%20help%3F%22%7D&envDescription=OPENAI_API_KEY%3A%20a%20key%20from%20a%20dedicated%20OpenAI%20project%20with%20a%20hard%20spend%20limit.%20CHAT_SECRET%3A%20at%20least%2032%20random%20characters%2C%20for%20example%20from%20node%20-e%20%22console.log%28require%28%27node%3Acrypto%27%29.randomBytes%2832%29.toString%28%27base64url%27%29%29%22.%20ASKDARE_MODEL%3A%20a%20current%20OpenAI%20model%20your%20project%20may%20use.%20ASKDARE_INSTRUCTIONS%3A%20what%20the%20bot%20does%20and%20how%20it%20answers.%20ASKDARE_GREETING%3A%20the%20first%20message%20in%20the%20chat.&envLink=https%3A%2F%2Faskdare.vercel.app%2Fdocs%2Fdeployment%23one-click-deploy)

- **Vercel:** the button copies the starter into a new repository on your Git account, then asks for the variables. Enter your `OPENAI_API_KEY` and a new `CHAT_SECRET` of at least 32 characters, for example from `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. `ASKDARE_MODEL` comes filled in with the starter's model; change it to one your project may use. `ASKDARE_INSTRUCTIONS` (what the bot does) and `ASKDARE_GREETING` (its first message) come filled in with the starter's defaults; change them to give the bot its job. To embed the chat on other sites later, add `ASKDARE_ALLOWED_ORIGINS` under **Settings → Environment Variables** and redeploy.
- **Heroku:** a Heroku button only deploys an app at the root of a repository, so it works from your own copy of the starter. Create one with `npx create-next-app --example https://github.com/boldare/askdare/tree/main/examples/starter my-chat`, push it to GitHub, then open `https://www.heroku.com/deploy?template=https://github.com/<you>/<repo>`. The starter's `app.json` asks for `OPENAI_API_KEY`, generates `CHAT_SECRET`, fills in `ASKDARE_MODEL`, offers the optional `ASKDARE_INSTRUCTIONS`, `ASKDARE_GREETING` and `ASKDARE_ALLOWED_ORIGINS`, and runs one web dyno with the `Procfile` from [Heroku](#heroku).

These settings live in your host's environment variables, which win over the defaults in `askdare.config.ts`. Change them there and redeploy, or delete them and edit the config in your repository.

Then check the live app from a local copy of that repository, with the production values in `.env.production.local`:

```bash
vercel env pull .env.production.local --environment=production
```

```bash
heroku config --shell --app <your app> > .env.production.local
```

```bash
npx @boldare/askdare doctor --url https://<your app> --env-file .env.production.local
```

A variable marked **Sensitive** on Vercel comes back empty from `vercel env pull`; paste its value into the file yourself. The starter keeps limits per instance, so before the chat is public, share them with Upstash (step 3 under [Vercel](#vercel)) and work through the [going-public checklist](going-public.md).

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
