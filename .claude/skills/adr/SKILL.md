---
name: adr
description: Write or update an Architecture Decision Record in docs/adr for askdare. Use when a decision is expensive to reverse (public API, data storage, security model, dependencies, packaging, supported platforms) or when a spike confirms or rejects a Proposed ADR.
---

# Architecture Decision Records

## When to write one

- **Write an ADR when the decision changes:**
  - the public API;
  - where data lives;
  - the threat model;
  - the support matrix;
  - packaging;
  - a core dependency;
  - anything a future contributor would otherwise "fix" back.
- **Skip it** for decisions that are cheap to reverse; a code comment or PR description is enough.

## How

1. Copy the template from `docs/adr/README.md` into `docs/adr/NNNN-kebab-title.md`, using the next free number. Never renumber existing ADRs.
2. Keep it short: context, decision, consequences and alternatives. Link evidence, such as `spikes/*/FINDINGS.md` or docs URLs.
3. Status:
   - `Proposed` while waiting on evidence;
   - `Accepted` once decided.
   - To reverse a decision, write a new ADR and set the old one to `Superseded by ADR-NNNN`. Don't rewrite history.
4. Update the index table in `docs/adr/README.md`.
5. Commit on its own branch as `docs(adr): <summary>` and merge into `main` with `--no-ff`.

## When a spike finishes

Read its `FINDINGS.md`, then for each linked Proposed ADR do one of the following:
- **Accept it**, adding a short "Evidence" section.
- **Amend the decision** to match the findings.
- **Supersede it**, if the spike rejected the approach.
