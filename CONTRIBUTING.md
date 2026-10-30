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
pnpm e2e            # build the starter and run Playwright against a mocked OpenAI
pnpm smoke          # live test against OpenAI (needs OPENAI_API_KEY and SMOKE_MODEL)
```

**Git hooks:**
- `pre-commit` runs Biome on staged files.
- `commit-msg` checks the Conventional Commits format.

**Supply-chain settings** (`pnpm-workspace.yaml`):
- Dependency install scripts are blocked unless allowed in `allowBuilds`.
- Versions published less than a day ago are not installed (`minimumReleaseAge`).

**Spikes:** throwaway experiments live in `spikes/` (see [spikes/README.md](spikes/README.md)).
