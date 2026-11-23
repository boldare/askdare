# Tasks

Open roadmap work, one file per task. [ROADMAP.md](../ROADMAP.md) says what each release contains; this folder holds the briefs for the work that is next. GitHub issues are for bug reports and feature requests from users, not for roadmap tasks.

## Rules

- **One file, one task, one branch, one pull request.** The file is the whole brief for whoever picks it up, person or agent. If it isn't enough, improve the file rather than passing context around.
- **File names** are `<release>-<id>-<short-name>.md`, for example `0.4-1a-texts-per-language.md`. The id gives the order inside a release.
- **Status lives in the file,** on the `Status` line:
  - `ready`: every task it depends on is done;
  - `blocked`: it waits for the tasks under "Depends on";
  - `in progress`: someone works on it, on the branch named in the file.
- **The pull request that finishes a task deletes its file.** The changeset, the ADRs and git history keep the record, so this folder only ever lists open work.
- **Only the next release gets task files.** Anything further out is a line under Later in the roadmap until it is planned.
- **Hot files** (listed in the roadmap) are changed by one task at a time. Tasks that don't touch them can run side by side.

## Template

```markdown
# <id>. <Title>

- **Status:** ready | blocked | in progress (`<branch>`)
- **Release:** 0.x
- **Lane:** Core | Ports | Add-ons | Hygiene | CI | Decisions | Docs | Spikes
- **Touches hot files:** No | Yes (which)
- **Changes the public API or the protocol:** No | Yes: API snapshot, ADR-0006 and a minor changeset | Yes: protocol, additive within v1
- **Depends on:** none | <ids>

## Goal

One or two sentences: what is true when this is done, for the user of askdare.

## Decisions to read first

ADRs and docs pages.

## Files and area

Where the change goes. Name existing functions to reuse.

## Don't touch

Files that other tasks own right now, and work that belongs to another task.

## Definition of Done

- [ ] Unit tests for the new behavior
- [ ] Docs updated
- [ ] Changeset (for changes to published packages)
- [ ] `pnpm check` passes
```
