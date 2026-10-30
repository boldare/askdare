# Contributing to askdare

Thanks for helping. This guide covers how we work. Setup commands are listed under [Development](#development).

## Before you start

- Read the [Architecture Decision Records](docs/adr/README.md). They explain *why* the code looks the way it does.
- For anything bigger than a bug fix, open an issue first so we can agree on the approach.
- A change that reverses an accepted decision needs a new ADR that supersedes the old one.

## Conventions

### Commits

We use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope?): summary`. A git hook checks the format.

| Type | Use for |
|---|---|
| `feat` | new user-facing functionality |
| `fix` | bug fixes |
| `docs` | documentation and ADRs |
| `refactor` | code changes that neither fix a bug nor add a feature |
| `perf` | performance improvements |
| `test` | adding or fixing tests |
| `build` | build system, dependencies, packaging |
| `ci` | CI configuration |
| `chore` | everything else (tooling, repository maintenance) |

### Branches

- One branch per change, named `type/short-description`, for example `feat/tool-loop` or `docs/threat-model`.
- `main` is always releasable. Branches are merged with `--no-ff`.

### Changesets

Every change to a published package needs a changeset (`pnpm changeset`). Pre-1.0, a minor release may break; a patch release never does (see [ADR-0006](docs/adr/0006-support-matrix-and-versioning.md)).

### Module boundaries (enforced by lint)

- Only `packages/askdare/src/openai/` may import `openai`.
- Published type declarations must not contain `openai` or `next` types. A CI test checks this.
- Never hardcode OpenAI model IDs in the library.

## AI-assisted development

The repository ships configuration for Claude Code:
- `CLAUDE.md`: project instructions;
- `.mcp.json`: read-only MCP servers for OpenAI and Next.js docs;
- `.claude/skills/`: vetted, pinned skills.

Review AI-generated changes like any other contribution.

## Development

**Prerequisites:**
- Node.js 22.18 or newer (24 recommended, see `.nvmrc`).
- pnpm 12. If your global pnpm is older, either run `npx pnpm@12.16.1 …` or install pnpm 12.

```bash
pnpm install        # installs dependencies and the git hooks (lefthook)
pnpm check          # lint, typecheck, tests, build, package checks; must pass before merging
pnpm test:watch     # Vitest in watch mode
pnpm format         # apply Biome formatting and safe fixes
pnpm changeset      # describe a change to a published package
pnpm e2e            # build site/ and run Playwright against a mocked OpenAI
pnpm e2e:browsers   # the embedding, page API and a11y specs in Firefox and WebKit
pnpm verify:packs   # pack the packages and try them in a fresh create-next-app
pnpm test:visual    # pixel baselines of the theme gallery
pnpm smoke          # live test against OpenAI (needs OPENAI_API_KEY and SMOKE_MODEL)
```

`pnpm smoke` costs real money: read [live testing](docs/live-testing.md) first. It covers the dedicated OpenAI project, the spend limit and where the key goes.

**Apps in the repository:**
- `site/` is the askdare website with the demo and the state gallery. Run it with `pnpm --dir site dev`; it reads `site/.env.local`.
- `examples/starter/` is the template users start from. Keep it exactly what `npx @boldare/askdare init` writes.

**Git hooks:**
- `pre-commit` runs Biome on staged files.
- `commit-msg` checks the Conventional Commits format.

**Supply-chain settings** (`pnpm-workspace.yaml`):
- Dependency install scripts are blocked unless allowed in `allowBuilds`.
- Versions published less than a day ago are not installed (`minimumReleaseAge`).

**Spikes:** throwaway experiments live in `spikes/` (see [spikes/README.md](spikes/README.md)).

## Releasing

Releases are made by CI from `main`, never from a laptop:

1. Changesets opens a "Version packages" pull request.
2. Merging it stages the new versions on npm (`scripts/stage-release.mjs`), with trusted publishing (OIDC) and provenance. The workflow runs in the `npm` environment, which only `main` may use. No npm token exists.
3. A maintainer approves each staged version with 2FA: npmjs.com → the package → Staged Packages, or `npm stage approve <stage-id>`. Only then is it published.

- Until 0.1.0 the repository is in pre-release mode (`.changeset/pre.json`), so versions are `0.1.0-rc.N` and go out under the npm tag `rc`.
- Before a release candidate, run `pnpm check`, `pnpm e2e`, `pnpm e2e:browsers`, `pnpm test:visual` and `pnpm verify:packs`, which installs the packed packages into a fresh Next.js app.
- For 0.1.0, run `pnpm changeset pre exit` in a pull request of its own.

The details are in the `release` skill (`.claude/skills/release/SKILL.md`).
