# ADR-0028: A 34 KB budget for the React entry, for Markdown fixes

- **Status:** Accepted
- **Date:** 2026-11-23
- **Supersedes in part:** [ADR-0023](0023-human-check-and-react-budget.md), decision 5 (the 33 KB budget of `@boldare/askdare/react`). The rest of ADR-0023 stands.

## Context

`@boldare/askdare/react` bundles `marked` to render answers. On `main` the entry is 33,374 of its 33,792 bytes gzipped (ADR-0023).

`marked` 18.2.1, a patch release, fixes about fifteen CommonMark cases our answers can hit: block quotes and lists with lazy lines, tabs, link destinations, bracket escapes in code spans, task-list markers and trailing blank lines in fenced code. Its own bundle grows by about 450 bytes gzipped, which takes the entry to about 33,980 bytes, over the budget.

ADR-0017 says a further addition needs room made first. A bug-fix release of the Markdown renderer isn't an addition we chose, and keeping `marked` pinned would mean skipping its fixes, and any later security fix built on them, until room is made.

## Decision

1. `@boldare/askdare/react` may take up to **34 KB** gzipped in an app's bundle (`packages/askdare/scripts/react-size.mjs`). The headless budget (12 KB for `Root` and `useChat`) and the embed budget (14 KB) are unchanged.
2. We take `marked` 18.2.1 now.
3. ADR-0017's rule applies again from 34 KB: the next feature that grows the entry makes room first.

## Consequences

- Answers render the CommonMark cases above correctly.
- About 800 bytes of headroom remain for future `marked` patches; features still have to make room.
- Making room in the entry (for example lazy-loading the Markdown renderer or the default look) stays a candidate task, not part of this decision.

## Alternatives considered

- **Pin `marked` at 18.2.0 and ignore it in Dependabot:** keeps the budget, but leaves rendering bugs in and puts every later `marked` release behind a refactor.
- **Make room first:** the right long-term move, but a refactor of the entry shouldn't block a patch-level dependency update.
