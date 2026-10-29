# Getting started

From an empty Next.js app to a working chat in about 15 minutes. You need Node 22 or later, a Next.js 16 app that uses the App Router, and an OpenAI account.

No Next.js app yet? Create one with the [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation), then come back.

## 1. Get an OpenAI key

1. In the [OpenAI dashboard](https://platform.openai.com/), create a **new project** just for this chat.
2. Set a **monthly budget with a hard limit** for the project, so a busy day can never cost more than you planned.
3. Create an **API key** in that project. Keep it out of chats, tickets and your shell history.

The [going-public checklist](going-public.md) covers restricted keys and model allowlists before you go live.

## 2. Add chatdock

In the folder of your app:

```bash
npm install @boldare/chatdock zod
npx @boldare/chatdock init
```

Use `pnpm add`, `yarn add` or `bun add` if that's what your app uses. `init` adds:

| File | What it is |
|---|---|
| `chatdock.config.ts` | Your bot: its model, instructions, the sites that may embed it, and how the chat looks. |
| `app/api/chat/[...path]/route.ts` | The single route that serves the chat, its API and its assets. |
| `.env.local` | `OPENAI_API_KEY`, a generated `CHAT_SECRET` and `CHATDOCK_MODEL`. It also makes sure `.gitignore` covers the file. |
| `app/layout.tsx` | One `<script>` tag that shows the chat button on every page. |

It never overwrites a file, so it's safe to run again.

## 3. Fill in `.env.local`

```bash
OPENAI_API_KEY=sk-...        # the key from step 1
CHATDOCK_MODEL=...           # a current model, see https://platform.openai.com/docs/models
```

chatdock never picks a model for you: models change every few months, and the choice decides your costs.

## 4. Run it and check it

```bash
npm run dev
npx @boldare/chatdock doctor
```

Open http://localhost:3000. The chat button is in the bottom-right corner.

`doctor` checks your project and your environment. It then asks the running app to test its own setup: the OpenAI key, the model, the permissions the key needs, the knowledge base, and the headers that let other sites embed the chat. Every problem comes with what to do about it:

```text
Bot "support"
  ✓ Model gpt-… is available.
  ✓ The key can create responses with gpt-….
  ✓ The key can create and delete conversations.
  ✓ widget.js loads.
  ✓ Sites that may embed the chat: 'self'
```

## 5. Put the chat on another website

The chat can live on any site, not only on your Next.js app:

1. Add the site to `security.allowedOrigins` in `chatdock.config.ts`, for example `['https://www.example.com']`.
2. Paste one tag into that site's HTML:

   ```html
   <script src="https://your-app.example.com/api/chat/widget.js?bot=support" async></script>
   ```

Browsers refuse to show the chat on sites that aren't on the list.

## Next steps

| To… | Read |
|---|---|
| Answer from your documents, with citations | [Knowledge base](knowledge-base.md) |
| Let the bot call your own functions | [Tools](tools.md) |
| Accept images and PDFs | [Attachments](attachments.md) |
| Let visitors dictate | [Voice input](voice-input.md) |
| Change texts, language, colors or the button | [Styling](styling.md) and [Themes](themes.md) |
| Deploy to Vercel or Heroku | [Deployment](deployment.md) |
| Open the chat to the public | [Going public](going-public.md) |
