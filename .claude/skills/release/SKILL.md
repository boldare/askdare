---
name: release
description: How changes to published chatdock packages are versioned and released (Changesets, 0.x policy, public API snapshot, trusted publishing). Use when finishing a change to packages/*, when the public API changes, or when preparing a release.
---

# Releasing chatdock

## For every change to a published package

1. Add a changeset with `pnpm changeset`. Pick the bump using the 0.x policy (ADR-0006):
   - **minor**: new features, and any breaking change while we are pre-1.0;
   - **patch**: fixes only, never breaking.

   Write the summary for users: what changed and what they must do.
2. If the public API changed on purpose, update the `.d.ts` snapshot and explain the change in the changeset. If it changed by accident, fix the code. The public surface is listed in ADR-0006.
3. Removing something requires a deprecation warning released at least one minor version earlier.
4. `pnpm check` must pass: lint, typecheck, test, build, publint, attw, no-leak and size-limit.

## Commits and branches

- Conventional Commits, one branch per change, merged into `main` with `--no-ff`.
- The changeset file is committed together with the change it describes.

## Publishing (only with the user's explicit approval)

- **Until the publication step (plan step 4.6), nothing leaves this machine.** No `git push`, no `npm publish`, no remote repository.
- Once published, releases go only through CI:
  - the Changesets "version packages" PR;
  - npm **trusted publishing (OIDC)** with provenance.

  Never run `npm publish` locally, and never store an npm token.
