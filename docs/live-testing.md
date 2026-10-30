# Live testing against the OpenAI API

Unit, integration and e2e tests never touch the network. Live checks (`pnpm smoke`, the spikes in `spikes/`) do, so they need a key. Set it up like this, once per developer.

## 1. A dedicated, capped OpenAI project

1. In the OpenAI dashboard, create a project only for this purpose, for example `askdare-dev`. Never use a project that production or other apps share.
2. In the project's **limits**:
   - set a small **monthly budget** (for example $5) with the **hard limit enforced**, and an email alert;
   - restrict **models** to the one you test with.
3. Create an API key **in that project**:
   - **Restricted** permissions: Responses, Conversations, Files and Vector stores set to write, Models set to read, everything else none.
   - If the dashboard doesn't offer one of these, use "All" for this project only. The hard limit and the model allowlist still cap the damage.

## 2. Put the key in a git-ignored file, not in the chat or your shell history

Copy the key in the browser, then run this in the repository root:

```bash
printf 'OPENAI_API_KEY=%s\nSMOKE_MODEL=%s\n' "$(pbpaste)" "gpt-6.1-terra" > .env.smoke.local && chmod 600 .env.smoke.local && pbcopy < /dev/null
```

- `.env.smoke.local` matches `.env.*` in `.gitignore`. `git check-ignore .env.smoke.local` must print the file name.
- `$(pbpaste)` keeps the key out of your shell history, and the last command clears the clipboard. On Linux, use `xclip -o` / `wl-paste` instead of `pbpaste`.
- `SMOKE_MODEL` must be a current model allowed in the project. Spike S1 sends an image and a PDF and asks for reasoning, so pick one that supports vision.
- **Never paste the key into an AI chat, an issue or a commit.**

Already set up `site/.env.local` or `examples/starter/.env.local` (from `.env.example`)? The smoke test reuses it when `.env.smoke.local` is absent, with `ASKDARE_MODEL` as the model, so the key lives in one file only.

The file search smoke test runs only with `SMOKE_VECTOR_STORE_ID` (or the starter's `KB_VECTOR_STORE_ID`): a store synced from `site/knowledge` with `pnpm --dir site kb:sync`. It is not deleted afterwards, so the next run reuses it.

## 3. Run

```bash
pnpm smoke                                                 # live test of the askdare OpenAI gateway
cd spikes/s1-openai && pnpm install --ignore-workspace && pnpm start   # spike S1
```

Both clean up what they create (conversations, files, vector stores).

## 4. Afterwards

- Revoke or rotate the key when you no longer need it.
- Check the project's usage page. A full S1 run uses a few tens of thousands of tokens.
