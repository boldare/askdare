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
| React | 19 in your app. The script-tag widget needs no React: it is a prebuilt iframe app. `@boldare/askdare/react` (0.2, ADR-0011) has the optional peer `^19`. | 18 |
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
  - `getChatConfig`, and everything `@boldare/askdare/react` exports: `Root`, `DefaultChat`, `Theme`, the hooks and the primitives (ADR-0011);
  - the `data-askdare-root` attribute of the theme root;
  - the script tag's `data-*` attributes (`data-follow-lang` included) and the `askdare()` JS API, `identify`, `on`, `off` and `configure({ locale })` included (ADR-0014);
  - the chat event catalog and `Root`'s `onEvent` (ADR-0013);
  - the built-in tool names `defineBot` reserves: `file_search` and `suggest_replies` (ADR-0015);
  - the identity token's claims, `IDENTITY_SECRET` and `context.identity` (ADR-0009);
  - `--ask-*` tokens, `data-ask-part` names and dictionary keys;
  - the shadow parts on the host page (`launcher`, `panel`, `unavailable`) and the host element's `data-askdare` attribute;
  - the protocol version;
  - ports implemented by official add-ons: `RateLimitStore` (and `CounterHit`);
  - the `askdare` commands and their options (`init`, `doctor`, `kb sync`, `add ui`), but not their printed output or the `/doctor` report behind `doctor`. The files `add ui` copies are the user's code from then on: their content is not API;

  Everything else is internal.
- **Guards** (published for users in [Support](../support.md)):
  - a `.d.ts` snapshot (`packages/askdare/api/askdare.api.txt`) fails the check when the published types change, until it is updated on purpose with a changeset; a consumer project type-checks the published `.d.ts` with TypeScript 5.9, 6.0 and 7.0;
  - size budgets fail the build: loader 5 KB, chat app 50 KB, its styles 8 KB, each preset's fonts 82 KB, and `@boldare/askdare/react` 32 KB in an app's bundle, or 12 KB for a page that uses only `Root` and `useChat` (gzipped);
  - a nightly canary runs the checks and browser tests against `next@canary` and `openai@latest` (with the mocked OpenAI API);
  - a daily live smoke test runs on a cheap model in a dedicated, spend-capped OpenAI project, so a retired model or a changed API fails there.

## Consequences

- Issues from unsupported setups are closed with a link to this ADR.
- Upgrading the Next.js or React major is a deliberate, planned change, not something that breaks unexpectedly.
