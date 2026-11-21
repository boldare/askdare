# ADR-0020: Public API clean-up for 0.5

- **Status:** Accepted (2026-11-21)
- **Date:** 2026-11-21
- **Supersedes in part:** [ADR-0006](0006-support-matrix-and-versioning.md). This replaces the "Zod" and "Node.js" rows of its support matrix, and adds to and removes from its list of public exports as below. The rest of ADR-0006 stands.

## Context

An audit of the published types (`packages/askdare/api/askdare.api.txt`, November 2026) found the surface coherent, but with four things that will be harder to change once add-ons (admin, Postgres store) and 1.0 depend on them:
- **Resolved shapes are exported.** `Bot` (with `Required<BotLimits>`) and `BotWidget` are what `defineBot` returns after filling defaults. Exporting them freezes internal defaults as public types. Users write `BotDefinition`.
- **Error codes can't be imported as values.** `ErrorCode` and `ERROR_CODES` appear in the generated declarations of `next` and `react`, but no entry point exports them. Code that switches on `onError`'s `code` or on `useChat`'s error has to copy strings.
- **`PROTOCOL_VERSION`** is exported from `.` but not listed in ADR-0006.
- **`zod` is a required peer,** even for a site that only uses the script tag and defines no tools.

Separately, Node 26 became LTS in October 2026, and CI tests it from 0.4.x on.

Breaking changes are allowed in 0.x minors (ADR-0006). Making them now, together, costs less than making them one by one later.

## Decision

From 0.5:
1. **`Bot` and `BotWidget` are no longer exported.** `defineBot` returns an opaque `BotHandle` type with no public members. The handler and `getChatConfig` accept it.
2. **`ERROR_CODES` (a readonly array) and `ErrorCode` are exported from `.`** and are public API. Adding a code is a minor change, and removing one is breaking.
3. **`PROTOCOL_VERSION` is public API,** exported from `.` as today.
4. **`zod` becomes an optional peer** (`peerDependenciesMeta.zod.optional`). `defineTool` and tool schemas still need it, and its docs say so. A missing `zod` fails with a clear message only when a tool is defined.
5. **Support matrix changes:**
   - **Node.js:** 22, 24 and 26 (`engines: >=22`).
   - **Zod:** `^4.1`, an optional peer that tools require.

The type-only removals in point 1 can't carry a runtime deprecation warning one minor earlier, as ADR-0006 otherwise asks. The 0.5 changeset and `docs/support.md` name the replacement instead.

## Consequences

- Add-ons and 1.0 build on a smaller, intentional surface.
- Users who annotated variables as `Bot` must switch to `BotDefinition` or `BotHandle`. This is a one-line change, named in the changeset.
- `ERROR_CODES` becomes a promise: every new code is a documented, minor change.
- One more `peerDependenciesMeta` entry to keep correct, checked by publint and attw.

## Alternatives considered

- **Leave the surface as it is until 1.0:** each change gets more expensive as add-ons and apps depend on the resolved types.
- **Deprecate first, remove in 0.6:** there is no runtime to warn in for a type. A `@deprecated` tag helps only editors, and 0.x already allows the break.
- **Drop `zod` for a schema-agnostic tool API (Standard Schema):** worth looking at before 1.0, but it changes `defineTool` for every tool user. It is out of scope here.
