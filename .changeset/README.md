# Changesets

Every change to a published package (`packages/*`) needs a changeset. Run `pnpm changeset`, pick the bump, and write a summary aimed at users.

During 0.x a **minor** bump may contain breaking changes and a **patch** bump never does. See [ADR-0006](../docs/adr/0006-support-matrix-and-versioning.md) and the `release` skill.
