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
- The SSE protocol has its own version (`x-chatdock-protocol`).
- **The public surface is exactly:**
  - `defineBot`, `defineTool`, `createChatHandler` (and `defineTheme`);
  - the script tag's `data-*` attributes and the `chatdock()` JS API;
  - `--cd-*` tokens, `data-cd-part` names and dictionary keys;
  - the protocol version;
  - ports implemented by official add-ons: `RateLimitStore` (and `CounterHit`).

  Everything else is internal.
- **Guards:**
  - a `.d.ts` snapshot fails CI when it changes without a changeset;
  - a nightly canary runs against `next@canary`, `openai@latest` and checks the configured models still exist;
  - a daily live smoke test runs on a cheap model in a dedicated, spend-capped OpenAI project.

## Consequences

- Issues from unsupported setups are closed with a link to this ADR.
- Upgrading the Next.js or React major is a deliberate, planned change, not something that breaks unexpectedly.
