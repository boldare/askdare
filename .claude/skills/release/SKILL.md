---
name: release
description: How changes to published askdare packages are versioned and released (Changesets, 0.x policy, public API snapshot, trusted publishing). Use when finishing a change to packages/*, when the public API changes, or when preparing a release.
---

# Releasing askdare

## For every change to a published package

1. Add a changeset with `pnpm changeset`. Pick the bump using the 0.x policy (ADR-0006):
   - **minor**: new features, and any breaking change while we are pre-1.0;
   - **patch**: fixes only, never breaking.

   Write the summary for users: what changed and what they must do.
2. If the public API changed on purpose, update the `.d.ts` snapshot and explain the change in the changeset. If it changed by accident, fix the code. The public surface is listed in ADR-0006.
3. Removing something requires a deprecation warning released at least one minor version earlier.
4. `pnpm check` must pass: lint, typecheck, test, build, publint, attw, no-leak and the size budgets of the asset build.

## Commits and branches

- Conventional Commits, one branch per change, merged into `main` with `--no-ff`.
- The changeset file is committed together with the change it describes.

## Release candidates

The repository is in Changesets pre-release mode (`.changeset/pre.json`, tag `rc`) until 0.1.0:

- `pnpm changeset version` turns the pending changesets into `0.1.0-rc.N` versions and `CHANGELOG.md` entries; the starter's dependency range follows.
- In CI, `changeset publish` publishes them under the npm dist-tag `rc`, so `npm install @boldare/askdare` doesn't pick them up by accident. Users install with `@rc`.
- For 0.1.0: `pnpm changeset pre exit`, then `pnpm changeset version`, and the next release goes out under `latest`.
- Before every release candidate: `pnpm check`, `pnpm e2e`, `pnpm e2e:browsers`, `pnpm test:visual` and the tarball check (`pnpm verify:packs`).

## Publishing (only with the user's explicit approval)

- **Until the publication step (plan step 4.6), nothing leaves this machine.** No `git push`, no `npm publish`, no remote repository.
- Once published, releases go only through CI:
  - the Changesets "version packages" PR;
  - npm **trusted publishing (OIDC)** with provenance.

  Never run `npm publish` locally, and never store an npm token.
