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

- **Core:** a single npm package, `@boldare/askdare`. It is ESM-only and exposes subpath exports:
  - `@boldare/askdare`: `defineBot`, `defineTool`, domain types.
  - `@boldare/askdare/next`: `createChatHandler`.
  - `@boldare/askdare/react`: headless UI, from 0.2.
  - A `bin` with the CLI (`init`, `doctor`, `kb sync`).
- **Add-ons:** separate packages that implement core ports, added only when needed:
  - `@boldare/askdare-upstash`: shared limits, in 0.1.
  - `@boldare/askdare-store-postgres` and `@boldare/askdare-admin`: later, on demand.
- **Scaffolding:** `create-next-app --example` pointing at `examples/starter`. There is no `create-*` package.
- **Integration surface:** one route file plus one `<script>` tag.
- **Naming:**
  - the package is `@boldare/askdare`, and add-ons are `@boldare/askdare-*`;
  - the CLI binary is `askdare`, run as `npx @boldare/askdare <command>`;
  - no "OpenAI" or "GPT" in any name (OpenAI brand guidelines).
- **A new name, not version 2 of `@boldare/openai-assistant`** (2026-10-30). Users of 1.x can't upgrade in place: it was a NestJS module with an Angular widget, and this is a Next.js library. The old name also carries "OpenAI" and points to the API that was shut down. The old package is deprecated in favour of this one when this one is published, and the migration guide maps the old concepts to the new ones.

### The name: askdare (2026-10-30)

The project started as **chatdock**. Before the first release it was renamed to **askdare**:

- **Why not chatdock:** a Shopify app called "ChatDock: Chat Button Pro" sells a chat button for websites, the same category, and the name had no link to Boldare.
- **The new name:** "ask" plus the "dare" of Boldare (bold + dare). Its tagline is "Dare to ask", in Polish "Śmiało, pytaj".
- **Names ruled out:**
  - BoldChat, a known live chat product;
  - ChatBLDR, an existing document chatbot;
  - chatbol, which reads as a typo of "chatbot", and in Polish as "czat-ból" ("chat pain").
- **What the rename touched:**
  - the package names and the CLI;
  - the browser global `window.askdare` and the `data-askdare` attributes;
  - the `ASKDARE_*` environment variables;
  - the CSS prefixes `--ask-*` and `data-ask-*`;
  - the protocol headers and storage keys.

Nothing had been published, so no user code broke.

## Consequences

- One core version means the client and server protocol can never drift apart. Changesets stays simple.
- Add-ons with heavy dependencies (Redis, Postgres) don't burden users who don't need them.
- The public surface must stay deliberately small. ADR-0006 lists the 0.x policy and the exact public surface.
- `examples/starter` is the scaffold source and the docs sample: exactly what `init` produces. The e2e target is the private `site/` app (see below).

### The starter and the site are separate apps (2026-10-30)

Until the pre-release audit, `examples/starter` was the template, the e2e target and the Boldare demo at once. It grew three.js, five bots, the state gallery and a `workspace:` dependency, so it no longer worked as a template or for a "15 minutes from zero" test. Before the first release candidate it was split:

- **`examples/starter`:** the minimal template. One bot, the route, `askdare.config.ts` and the `next/script` tag, all written by `npx @boldare/askdare init`, plus `.env.example` and a README with Vercel and Heroku steps. Its `@boldare/askdare` dependency is a semver range that pnpm links to the workspace (`linkWorkspacePackages`), so `create-next-app --example` works once the package is on npm. The tarball check before each release candidate builds a fresh app from the packed packages.
- **`site/`:** the askdare website, private and never published. It holds the demo, the state gallery and the docs, and is the e2e and visual test target.

## Alternatives considered

- **Template only.** Rejected: there is no way to ship security fixes to existing deployments.
- **Multiple core packages** (`core`, `react`, `next`, `embed`). Rejected: version skew between client and server, and more release work.
- **Platform first.** Deferred: the admin and store add-ons can grow into it later.
