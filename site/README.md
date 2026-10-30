# askdare website

The demo, the state gallery and the docs (`/docs`), in one private Next.js app. It is the e2e target too; see `CLAUDE.md` here and in the repository root.

## Run it locally

From the repository root, with a key in `examples/starter/.env` or `site/.env.local`:

```bash
pnpm install
pnpm --dir site dev
```

## Deploy to Vercel

The site builds from the monorepo: `vercel.json` here installs with pnpm and builds the packages before `next build`.

1. **Import the project.** Vercel → Add New → Project → import `boldare/askdare`. The Vercel GitHub app needs access to the `boldare` organization, which an organization owner may have to approve.
   - **Root Directory:** `site`. Leave "Include files outside the root directory" on: the site uses the packages and the docs in the repository.
   - **Framework:** Next.js, detected. Install and build commands come from `vercel.json`.
2. **Environment variables**, for Production and Preview:

   | Variable | Value |
   | --- | --- |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so Vercel uses the repository's pnpm version (`packageManager`) |
   | `OPENAI_API_KEY` | A key from a dedicated OpenAI project with a hard spend limit |
   | `CHAT_SECRET` | A new secret: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` |
   | `ASKDARE_MODEL` | A current model, e.g. the one in `.env.example` |
   | `KB_VECTOR_STORE_ID` | The demo bots' documents (Brightloop), synced with `pnpm --dir site kb:sync` |
   | `DOCS_VECTOR_STORE_ID` | The docs chat's store, synced with `node site/scripts/docs-kb.mjs` |
   | `ASKDARE_GALLERY` | Optional: `1` to serve `/gallery` |

3. **Shared limits.** Vercel runs several instances at once, and each would count the limits on its own. Storage → Upstash for Redis (Marketplace, free plan) → connect it to the project. It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and the chat route then uses `@boldare/askdare-upstash`.
4. **Deploy**, then check the live site:

   ```bash
   npx @boldare/askdare doctor --url https://<project>.vercel.app --env-file <a file with the production CHAT_SECRET>
   ```

5. **Point the docs chat at the site:** sync once more with the site's address, so citations link to it:

   ```bash
   SITE_URL=https://<project>.vercel.app node site/scripts/docs-kb.mjs
   ```

Vercel's Hobby plan is free but meant for non-commercial use. For a company project, use a team plan or Vercel's open-source program. Before the site is public, work through `docs/going-public.md`.
