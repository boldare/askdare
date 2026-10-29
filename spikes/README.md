# Spikes

Time-boxed experiments that confirm or reject a decision before we build on it. Each spike answers specific questions from a Proposed ADR and ends with a `FINDINGS.md` that gives a go or no-go.

## Rules

- **Standalone:**
  - Each spike lives in its own folder (`s1-openai/`, `s2-build/`, `s4-embed/`) and is **not** part of the pnpm workspace.
  - Inside a spike, run `pnpm install --ignore-workspace`, or keep an own `pnpm-workspace.yaml` in the spike folder.
  - Library code never imports from `spikes/`.
- **Secrets stay out of git.** Use `.env` files inside the spike folder; the root `.gitignore` excludes them. Use a dedicated OpenAI project with a hard spend limit.
- **What gets committed:** `FINDINGS.md`, small scripts and redacted fixtures. Don't commit `node_modules` or build output.
- **Closing a spike:** update the linked ADR (accept, amend or supersede it). The `adr` skill describes how.
