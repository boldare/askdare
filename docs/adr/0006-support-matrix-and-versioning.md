# ADR-0006: Support matrix and versioning policy

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

A library runs inside its users' apps, so every supported combination of versions is a promise. A narrow, published matrix is the cheapest way to keep that promise.

## Decision

### Support matrix

| Area | Supported | Not supported |
|---|---|---|
| Node.js | 22 and 24 (`engines: >=22`) | 20 or older (end of life) |
| Next.js | 16.x, latest minor (peer `^16`), App Router, Node.js runtime | Pages Router, Edge runtime, static export |
| React | 19 (peer `^19`) | 18 |
| Zod | `^4.1` (peer, required) | 3 |
| Bundlers | Turbopack (default) and `next build --webpack` | |
| Consumer TypeScript | 5.9, 6.0 and 7.0 (published `.d.ts` tested against each) | |
| Hosting | Vercel and Heroku, both documented and smoke-tested | Others are unsupported but expected to work if they run `next start` |

### Versioning (0.x)

- **Minor** releases may break; **patch** releases never do.
- A removal is preceded by a deprecation warning one minor earlier.
- Every change carries a changeset.
- The SSE protocol has its own version (`x-askdare-protocol`).
- **The public surface is exactly:**
  - `defineBot`, `defineTool`, `createChatHandler` (and `defineTheme`);
  - the script tag's `data-*` attributes and the `askdare()` JS API, `identify` included;
  - the identity token's claims, `IDENTITY_SECRET` and `context.identity` (ADR-0009);
  - `--ask-*` tokens, `data-ask-part` names and dictionary keys;
  - the protocol version;
  - ports implemented by official add-ons: `RateLimitStore` (and `CounterHit`);
  - the `askdare` commands and their options (`init`, `doctor`, `kb sync`), but not their printed output or the `/doctor` report behind `doctor`.

  Everything else is internal.
- **Guards** (published for users in [Support](../support.md)):
  - a `.d.ts` snapshot (`packages/askdare/api/askdare.api.txt`) fails the check when the published types change, until it is updated on purpose with a changeset; a consumer project type-checks the published `.d.ts` with TypeScript 5.9, 6.0 and 7.0;
  - size budgets fail the build: loader 5 KB, chat app 50 KB, its styles 8 KB, each preset's fonts 82 KB (gzipped);
  - a nightly canary runs the checks and browser tests against `next@canary` and `openai@latest` (with the mocked OpenAI API);
  - a daily live smoke test runs on a cheap model in a dedicated, spend-capped OpenAI project, so a retired model or a changed API fails there.

## Consequences

- Issues from unsupported setups are closed with a link to this ADR.
- Upgrading the Next.js or React major is a deliberate, planned change, not something that breaks unexpectedly.
