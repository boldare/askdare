# Command line

askdare comes with a small command-line tool. Run it with `npx` in the folder of your Next.js app:

```bash
npx @boldare/askdare <command> [options]
```

| Command | What it does |
| --- | --- |
| [`init`](#init) | Adds askdare to the app: a bot config, the route, `.env.local` and the chat script. |
| [`doctor`](#doctor) | Checks the project, its environment and the running app. |
| [`kb sync <folder>`](#kb-sync) | Makes an OpenAI vector store mirror a folder of documents. |
| [`-v`, `--version`](#version-and-help) | Prints the installed version. |
| [`-h`, `--help`](#version-and-help) | Prints the usage. |

The commands and their options are public API ([ADR-0006](adr/0006-support-matrix-and-versioning.md)). Their printed output is not, and may change in any release.

## init

Adds askdare to the Next.js app in the current folder. It never overwrites a file, so it's safe to run again.

```bash
npx @boldare/askdare init
npx @boldare/askdare init --bot sales --model <model>
```

| Option | Default | What it does |
| --- | --- | --- |
| `--bot <id>` | `support` | The bot's ID: 1 to 48 lowercase letters, digits or dashes, starting with a letter or digit. It goes into `askdare.config.ts` and the script tag. |
| `--model <id>` | none | The OpenAI model to put into `.env.local` as `ASKDARE_MODEL`. Without it, `ASKDARE_MODEL` stays empty for you to fill in. It never replaces a value that's already there. |
| `-h`, `--help` | | Prints the usage. |

The folder needs a `package.json` with `next` among its dependencies, and an `app/` or `src/app/` folder.

### What it writes

| File | What `init` does | When it leaves the file alone |
| --- | --- | --- |
| `askdare.config.ts` | Creates one bot: the ID, `model: process.env.ASKDARE_MODEL ?? ''`, short instructions, an empty `security.allowedOrigins`, `locale: 'auto'`, a greeting and the `aura` theme. It is `askdare.config.js` when the project has no `tsconfig.json`. | An `askdare.config` file already exists (`.ts`, `.tsx`, `.js`, `.jsx` or `.mjs`). |
| `app/api/chat/[...path]/route.ts` | Creates the catch-all route: `export const maxDuration = 300;` and `createChatHandler({ bots })`. Under `src/app/` if that's where your app is. | A route file is already there. |
| `.gitignore` | Appends `.env*.local`, so secrets never land in git. | Git already ignores `.env.local` and `.env.production.local`. |
| `.env.local` | Appends, under `# askdare`, each with a comment: `OPENAI_API_KEY` (empty), `CHAT_SECRET` (32 random bytes, base64url) and `ASKDARE_MODEL` (the `--model` value, or empty). A new file is readable only by you. | Skips each variable that `.env.local` or `.env` already defines. It never changes existing lines. |
| Root layout, such as `app/layout.tsx` | Adds `import Script from 'next/script';` and, before `</body>`, `<Script src="/api/chat/widget.js?bot=support" strategy="afterInteractive" />` with your bot ID. | The layout already loads `/api/chat/widget.js`. With no layout, or more than one `</body>`, it prints the two lines for you to add by hand. |
| `AGENTS.md` | Appends a short block that tells AI coding agents to read `node_modules/@boldare/askdare/llms.txt` before changing the chat, and to run `doctor` afterwards. Creates the file if needed. | The block is already there. |

Each line of the output starts with `+` for something added or `=` for something kept. Then `init` lists what is left to do:

```text
askdare init

  + askdare.config.ts
  + app/api/chat/[...path]/route.ts
  + .env.local: OPENAI_API_KEY, CHAT_SECRET (generated), ASKDARE_MODEL
  + app/layout.tsx: the chat script
  + AGENTS.md: where AI coding agents find the askdare docs

Next:
  1. In .env.local, set OPENAI_API_KEY, ASKDARE_MODEL.
  2. Start the app (npm run dev), then check it: npx @boldare/askdare doctor
  3. To embed the chat on another site, add that site to allowedOrigins and paste:
       <script src="https://<your app>/api/chat/widget.js?bot=support" async></script>
```

The list also tells you to install `@boldare/askdare` and `zod` if they're missing, and to upgrade `zod` when it's older than 4. It uses your package manager, which it detects from the lockfile.

## doctor

Checks the project, its environment and the running app, and says what to do about each problem. Start the app first, then run `doctor` in a second terminal:

```bash
npx @boldare/askdare doctor
npx @boldare/askdare doctor --origin https://www.example.com
npx @boldare/askdare doctor --url https://app.example.com --env-file .env.production.local
```

| Option | Default | What it does |
| --- | --- | --- |
| `--url <url>` | `http://localhost:3000` | Where the app runs. It must use `https`; plain `http` only for `localhost`, `127.0.0.1`, `[::1]` and `*.localhost`. |
| `--base-path <path>` | `/api/chat` | The path of the askdare route, if you mounted it elsewhere (`basePath` in `createChatHandler`). |
| `--env-file <path>` | `.env.development.local`, `.env.local`, `.env.development` and `.env` | Where to read `CHAT_SECRET` and the other variables. |
| `--origin <url>` | none | A site that should embed the chat. `doctor` checks it against each bot's `security.allowedOrigins`. Only the origin of the URL counts. |
| `-h`, `--help` | | Prints the usage. |

Without `--env-file`, `doctor` reads the environment the way `next dev` does: variables in your shell win, then the files in the order above. With `--env-file`, it reads only that file, and the file wins over your shell.

### What it checks

**Project**

- Node 22 or later.
- At least Next.js 16, React 19 and zod 4.1, and `@boldare/askdare`, as installed in `node_modules`.
- The route file, `app/api/chat/[...path]/route.ts` (it follows `--base-path`): it calls `createChatHandler`, doesn't use the Edge runtime, and has a literal `maxDuration`. A missing `maxDuration` is a warning.
- A `middleware.ts`: a warning to rename it to `proxy.ts`.

**Environment**

- `OPENAI_API_KEY` is set, for an app on your machine.
- `CHAT_SECRET` is set and strong: at least 32 characters, with at least 12 different ones. The same goes for each secret in `CHAT_SECRET_PREVIOUS`.
- `IDENTITY_SECRET`, when set, is strong and differs from `CHAT_SECRET`.
- `ASKDARE_MODEL` is set and not empty, for an app on your machine, when `askdare.config` mentions it or the variable exists. Without a model the app fails to start, so set it in every environment of your host too.
- Every env file it read that holds `OPENAI_API_KEY` or `CHAT_SECRET` is ignored by git.

**The running app**

`doctor` asks the app at `--url` to test its own setup. The request carries a 2-minute token signed with `CHAT_SECRET`, so only someone who knows the app's secret can run it. Without `CHAT_SECRET`, the live checks are skipped with a warning.

- The app is reachable, in development or production. In production, `doctor` warns when the state gallery is on, and when rate limits are kept in memory per instance.
- It reports when the route redirects (often `proxy.ts`), when there is no askdare route, when the app's `CHAT_SECRET` differs from yours, when the app is switched off with `ASKDARE_DISABLED` or has no `CHAT_SECRET`, and when there were too many runs.

**Each bot**, with the key and model of the running app:

| Check | Passes when | The key permission it names when it fails |
| --- | --- | --- |
| Model | The bot's model is available to the OpenAI project. A key that may not look up models gives a warning instead. | List models: Read |
| Responses | The key can create a 16-token response with the bot's model. | Responses API: Write |
| Conversations | The key can create and delete a conversation. | Write access to conversations |
| Knowledge base | Only with `knowledge`: the vector store exists in the project and hasn't expired. A store without searchable documents, or with documents still indexing or failed, gives a warning. | Vector Stores: Read |
| Voice input | Only with `voice`: the transcription model is available, and the key can transcribe one second of silence. | Model capabilities: Request |
| Attachments | Only with `attachments`: the key can upload and delete a small file. | Files: Write |
| Headers | `widget.js?bot=<id>` answers with JavaScript, and the chat page answers without a redirect, without `X-Frame-Options` and with exactly one `frame-ancestors`. It lists the sites that may embed the chat, and warns when something sets cookies. | |
| `--origin` | The site is the app itself or is in the bot's `security.allowedOrigins`. | |
| Timeout | The route's `maxDuration` is at least the bot's `limits.turnTimeoutMs` plus 15 seconds. Otherwise it's a warning. | |

`doctor` also says when OpenAI rejects the key, or when the project is out of credit. Each run makes a few small OpenAI requests per bot, and everything it creates is deleted straight away. The app accepts one run at a time, and at most 3 a minute.

### Output

`✓` is fine, `!` is a warning and `✗` is a problem. A line starting with `→` says what to do:

```text
askdare doctor

Project
  ✓ Node 24.11.0
  ✓ next 16.0.1, react 19.2.0, zod 4.1.12, @boldare/askdare 0.1.0
  ✓ app/api/chat/[...path]/route.ts (maxDuration 300 s)

Environment (.env.local)
  ✓ OPENAI_API_KEY is set.
  ✓ CHAT_SECRET is strong.

App at http://localhost:3000
  ✓ Reachable (development).

Bot "support"
  ✓ Model <model> is available.
  ✓ The key can create responses with <model>.
  ✓ The key can create and delete conversations.
  ✓ widget.js loads.
  ✗ https://www.example.com may not embed the chat: it isn't in the bot's security.allowedOrigins.
    → Add 'https://www.example.com' to security.allowedOrigins of bot "support" and deploy.
  ✓ Sites that may embed the chat: 'self'

1 problem, 0 warnings.
```

### A deployed app

Point `--url` at the deployed app, and give `doctor` that app's `CHAT_SECRET` through `--env-file`:

```bash
npx @boldare/askdare doctor --url https://app.example.com --env-file .env.production.local
```

For an app that isn't on your machine, `doctor` skips the local `OPENAI_API_KEY` and `ASKDARE_MODEL` checks: the live checks test the deployed app's own key and model. Keep the file out of git; `init` already ignores `.env*.local`. See [Deployment](deployment.md).

## kb sync

Makes an OpenAI vector store mirror a folder of documents, for the bot's knowledge base. Re-running without changes does nothing.

```bash
npx @boldare/askdare kb sync knowledge
npx @boldare/askdare kb sync knowledge --dry-run
npx @boldare/askdare kb sync knowledge --store vs_… --env-file .env.production.local
```

| Option | Default | What it does |
| --- | --- | --- |
| `<folder>` | | The folder to mirror. Exactly one. |
| `--store <vs_…>` | `KB_VECTOR_STORE_ID` | The vector store to sync. Without either, `kb sync` creates a store, except with `--dry-run`. |
| `--name <name>` | `askdare knowledge` | The name of a newly created store. |
| `--env-file <path>` | `.env.local` and `.env` in the current folder, when present | Loads environment variables from this file. Variables in your shell win. |
| `--dry-run` | off | Shows what would change, without changing anything. |
| `-h`, `--help` | | Prints the usage of `kb sync`. |

It needs `OPENAI_API_KEY`. A store ID must look like `vs_…`.

What it changes in the store:

- Uploads new and edited files.
- Updates the title or URL of a file whose content didn't change.
- Deletes files that are no longer in the folder, and the old copy of each edited file, from the store and from the OpenAI project.
- Leaves files it didn't upload alone.

It reads `.md`, `.mdx`, `.txt`, `.pdf`, `.docx`, `.pptx`, `.html`, `.htm` and `.json`, and skips hidden files and `node_modules`. When it creates a store, it prints the line to add to your environment, `KB_VECTOR_STORE_ID=vs_…`. Titles, URLs and costs are in [Knowledge base](knowledge-base.md).

```text
Loaded .env.local.
+ pricing.md
+ guides/handbook.pdf
- old-plans.md
Synced: 2 added, 0 retagged, 1 removed, 12 unchanged.
```

A file that fails to upload is listed as `Failed: <path> (<reason>)`, and the rest of the sync goes on.

## Version and help

```bash
npx @boldare/askdare --version
npx @boldare/askdare --help
```

- `-v` or `--version` prints the installed version of `@boldare/askdare`.
- `-h`, `--help` or no command prints the usage of every command. `init --help` and `doctor --help` print the same text; `kb sync --help` prints the usage of `kb sync`.

## Exit codes

| Command | `0` | `1` |
| --- | --- | --- |
| `init` | Done. | The folder isn't a Next.js app with the App Router, or the bot ID is invalid. |
| `doctor` | No problems. Warnings don't count. | At least one `✗` problem. |
| `kb sync` | Done, or nothing to do. | At least one file failed to upload. |
| All | | An unknown command or option, or a missing or invalid value, such as a `--url` without `https` or no `OPENAI_API_KEY` for `kb sync`. The usage is printed with the error. Any other error is printed as `askdare: <message>`. |

`doctor` exits with `1` while there is a problem, so you can run it in CI after a deploy.
