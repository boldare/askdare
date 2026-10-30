# askdare website

The demo, the state gallery and the docs (`/docs`), in one private Next.js app. It is the e2e target too; see `CLAUDE.md` here and in the repository root.

## Run it locally

From the repository root, with a key in `examples/starter/.env` or `site/.env.local`:

```bash
pnpm install
pnpm --dir site dev
```

## Deploy to Vercel

GitHub Actions builds the site and uploads the build (`.github/workflows/deploy-site.yml`), so the Vercel project needs no access to the repository and no Git connection. `vercel.json` here installs with pnpm and builds the packages before `next build`.

1. **Create the project** once, from the repository root, after `npx -y vercel@65.4.0 login`:

   ```bash
   npx -y vercel@65.4.0 link --yes --project askdare
   ```

   Then, in the project's settings on vercel.com, set **Root Directory** to `site`.
2. **Variables** in the Vercel project (Production):

   | Variable | Value |
   | --- | --- |
   | `OPENAI_API_KEY` | A key from a dedicated OpenAI project with a hard spend limit |
   | `CHAT_SECRET` | A new secret: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` |
   | `ASKDARE_MODEL` | A current model, e.g. the one in `.env.example` |
   | `KB_VECTOR_STORE_ID` | The demo bots' documents (Brightloop), synced with `pnpm --dir site kb:sync` |
   | `DOCS_VECTOR_STORE_ID` | The docs chat's store, synced with `node site/scripts/docs-kb.mjs` |
   | `ASKDARE_GALLERY` | Optional: `1` to serve `/gallery` |

   Add each with `npx -y vercel@65.4.0 env add <NAME> production`, which asks for the value, or in the project's settings.
3. **GitHub:** in the `vercel` environment (only `main` may use it), add the secret `VERCEL_TOKEN` (a token from vercel.com → Account Settings → Tokens). The team and project IDs are in `deploy-site.yml` (from `.vercel/project.json` after step 1). Then set the repository variable `VERCEL_DEPLOY` to `true`. Every push to `main` that touches the site, the packages or the docs deploys; Actions → Deploy site → Run workflow deploys by hand.
4. **Shared limits (optional).** Vercel runs several instances at once, and each counts the limits on its own. Storage → Upstash for Redis (Marketplace, free plan) → connect it to the project. It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and the chat route then uses `@boldare/askdare-upstash`.
5. **Check the live site** and point the docs chat at it, so citations link there:

   ```bash
   npx @boldare/askdare doctor --url https://<project>.vercel.app --env-file <a file with the production CHAT_SECRET>
   ```

   ```bash
   SITE_URL=https://<project>.vercel.app node site/scripts/docs-kb.mjs
   ```

Importing the repository in Vercel (Git integration) works too, with Root Directory `site` and `ENABLE_EXPERIMENTAL_COREPACK=1`, but it needs the Vercel GitHub app on the `boldare` organization.

Vercel's Hobby plan is free but meant for non-commercial use. For a company project, use a team plan or Vercel's open-source program. Before the site is public, work through `docs/going-public.md`.
