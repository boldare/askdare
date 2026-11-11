# Getting started

From an empty Next.js app to a working chat in about 15 minutes. You need Node 22 or later, a Next.js 16 app that uses the App Router, and an OpenAI account.

No Next.js app yet? Create one with the [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation), then come back.

Just want to see it running first? Deploy the starter app in one click, then come back to add askdare to your own app:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fboldare%2Faskdare%2Ftree%2Fmain%2Fexamples%2Fstarter&project-name=askdare-chat&repository-name=askdare-chat&env=OPENAI_API_KEY%2CCHAT_SECRET%2CASKDARE_MODEL&envDefaults=%7B%22ASKDARE_MODEL%22%3A%22gpt-6.1-terra%22%7D&envDescription=OPENAI_API_KEY%3A%20a%20key%20from%20a%20dedicated%20OpenAI%20project%20with%20a%20hard%20spend%20limit.%20CHAT_SECRET%3A%20at%20least%2032%20random%20characters%2C%20for%20example%20from%20node%20-e%20%22console.log%28require%28%27node%3Acrypto%27%29.randomBytes%2832%29.toString%28%27base64url%27%29%29%22.%20ASKDARE_MODEL%3A%20a%20current%20OpenAI%20model%20your%20project%20may%20use.&envLink=https%3A%2F%2Faskdare.vercel.app%2Fdocs%2Fdeployment%23one-click-deploy)

[Deployment](deployment.md#one-click-deploy) covers what to fill in, Heroku, and how to check the live app with `doctor`.

## 1. Get an OpenAI key

1. In the [OpenAI dashboard](https://platform.openai.com/), create a **new project** just for this chat.
2. Set a **monthly budget with a hard limit** for the project, so a busy day can never cost more than you planned.
3. Create an **API key** in that project. Keep it out of chats, tickets and your shell history.

The [going-public checklist](going-public.md) covers restricted keys and model allowlists before you go live.

## 2. Add askdare

In the folder of your app:

```bash
npm install @boldare/askdare zod
npx @boldare/askdare init
```

Use `pnpm add`, `yarn add` or `bun add` if that's what your app uses. `init` adds:

| File | What it is |
|---|---|
| `askdare.config.ts` | Your bot: its model, instructions, the sites that may embed it, and how the chat looks. |
| `app/api/chat/[...path]/route.ts` | The single route that serves the chat, its API and its assets. |
| `.env.local` | `OPENAI_API_KEY`, a generated `CHAT_SECRET` and `ASKDARE_MODEL`. It also makes sure `.gitignore` covers the file. |
| `app/layout.tsx` | One `<Script>` tag (`next/script`) that shows the chat button on every page. |
| `AGENTS.md` | A short note that points AI coding agents to the askdare docs in `node_modules`. |

It never overwrites a file, so it's safe to run again.

Already know your model? `npx @boldare/askdare init --model <model>` fills in `ASKDARE_MODEL` too. Every option is in [Command line](cli.md#init).

## 3. Fill in `.env.local`

```bash
OPENAI_API_KEY=sk-...        # the key from step 1
ASKDARE_MODEL=...           # a current model, see https://platform.openai.com/docs/models
```

askdare never picks a model for you: models change every few months, and the choice decides your costs.

`ASKDARE_MODEL` must be set in every environment that builds the app, Vercel Preview included. Without it, `next build` fails with "model is required".

`init` already generated `CHAT_SECRET`. Each environment needs its own. To make a new one without `openssl`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Is the project already on Vercel? Keep the variables in its settings, and copy them to your machine with `vercel env pull .env.local`. See [Deployment](deployment.md#vercel).

## 4. Run it and check it

Start the app:

```bash
npm run dev
```

While it runs, check it from a second terminal:

```bash
npx @boldare/askdare doctor
```

Open http://localhost:3000. The chat button is in the bottom-right corner.

`doctor` checks your project and your environment. It then asks the running app to test its own setup: the OpenAI key, the model, the permissions the key needs, the knowledge base, and the headers that let other sites embed the chat. Every problem comes with what to do about it:

```text
Bot "support"
  ✓ Model <model> is available.
  ✓ The key can create responses with <model>.
  ✓ The key can create and delete conversations.
  ✓ widget.js loads.
  ✓ Sites that may embed the chat: 'self'
```

Every check and option is in [Command line](cli.md#doctor).

## 5. Put the chat on another website

The chat can live on any site, not only on your Next.js app:

1. Add the site to `security.allowedOrigins` in `askdare.config.ts`, for example `['https://www.example.com']`.
2. Paste one tag into that site's HTML:

   ```html
   <script src="https://your-app.example.com/api/chat/widget.js?bot=support" async></script>
   ```

Browsers refuse to show the chat on sites that aren't on the list. Check a site with `npx @boldare/askdare doctor --origin https://www.example.com`.

Staging and production usually embed the chat on different sites. Read the list from an environment variable, such as `ASKDARE_ALLOWED_ORIGINS`. [Embedding](embedding.md#staging-and-production) shows how, along with the script's options and your site's Content Security Policy.

## Working with an AI coding agent

`init` wrote `AGENTS.md`, which sends AI coding agents to `node_modules/@boldare/askdare/llms.txt`: the docs of the version you installed, not what the agent remembers. Claude Code can also use the `askdare` skill from the package. Copy it into your project:

```bash
mkdir -p .claude/skills && cp -R node_modules/@boldare/askdare/skills/askdare .claude/skills/
```

## Next steps

| To… | Read |
|---|---|
| Look up every option of a bot | [Configuration](configuration.md) |
| Embed the chat on other sites, inline or behind your own button | [Embedding](embedding.md) |
| Look up a command or its options | [Command line](cli.md) |
| Fix a chat that doesn't work | [Troubleshooting](troubleshooting.md) |
| Answer from your documents, with citations | [Knowledge base](knowledge-base.md) |
| Let the bot call your own functions | [Tools](tools.md) |
| Know who is signed in | [Signed-in visitors](identity.md) |
| Accept images and PDFs | [Attachments](attachments.md) |
| Let visitors dictate | [Voice input](voice-input.md) |
| Change texts, language, colors or the button | [Styling](styling.md) and [Themes](themes.md) |
| Put the chat inside a page of your app, without an iframe | [The chat inside your page](react.md) |
| Let visitors rate answers | [Answer ratings](feedback.md) |
| Track costs per turn, or trace with OpenTelemetry | [Observability](observability.md) |
| Deploy to Vercel or Heroku | [Deployment](deployment.md) |
| Open the chat to the public | [Going public](going-public.md) |
