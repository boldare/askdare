# ADR-0001: Product shape and packaging

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

`@boldare/openai-assistant` was a NestJS library with an Angular chat widget and an iframe embed script. It was built entirely on the OpenAI Assistants API, which OpenAI shut down on 2026-08-26, so the package no longer works. The mission stays the same: let developers quickly put an AI chatbot on a website.

We weighed three shapes:

| Shape | Upside | Downside |
|---|---|---|
| Template app (fork and deploy) | Cheapest to maintain: users own the copy | No update path for security fixes |
| Library for Next.js | Fixes reach every deployment via `pnpm up` | Every export is a long-lived contract; must work across the users' version matrix |
| Platform with admin panel | Highest business value | Roughly 3–4x the scope before a first release |

## Decision

We build a **library for Next.js**, structured as a small core plus optional add-ons in one monorepo.

- **Core:** a single npm package, `@boldare/chatdock`. It is ESM-only and exposes subpath exports:
  - `@boldare/chatdock`: `defineBot`, `defineTool`, domain types.
  - `@boldare/chatdock/next`: `createChatHandler`.
  - `@boldare/chatdock/react`: headless UI, from 0.2.
  - A `bin` with the CLI (`init`, `doctor`, `kb sync`).
- **Add-ons:** separate packages that implement core ports, added only when needed:
  - `@boldare/chatdock-upstash`: shared limits, in 0.1.
  - `@boldare/chatdock-store-postgres` and `@boldare/chatdock-admin`: later, on demand.
- **Scaffolding:** `create-next-app --example` pointing at `examples/starter`. There is no `create-*` package.
- **Integration surface:** one route file plus one `<script>` tag.
- **Naming:**
  - the package is `@boldare/chatdock`, and add-ons are `@boldare/chatdock-*`;
  - the CLI binary is `chatdock`, run as `npx @boldare/chatdock <command>`;
  - no "OpenAI" or "GPT" in any name (OpenAI brand guidelines).

## Consequences

- One core version means the client and server protocol can never drift apart. Changesets stays simple.
- Add-ons with heavy dependencies (Redis, Postgres) don't burden users who don't need them.
- The public surface must stay deliberately small. ADR-0006 lists the 0.x policy and the exact public surface.
- `examples/starter` is three things at once: the e2e test target, the scaffold source and the docs sample.

## Alternatives considered

- **Template only.** Rejected: there is no way to ship security fixes to existing deployments.
- **Multiple core packages** (`core`, `react`, `next`, `embed`). Rejected: version skew between client and server, and more release work.
- **Platform first.** Deferred: the admin and store add-ons can grow into it later.
