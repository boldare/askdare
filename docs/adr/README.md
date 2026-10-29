# Architecture Decision Records

Short records of decisions that are expensive to reverse. One decision per file, numbered, never renumbered. To change a decision, add a new ADR that supersedes the old one, and update the old one's status.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-shape-and-packaging.md) | Product shape and packaging | Accepted |
| [0002](0002-openai-only-no-leaked-types.md) | OpenAI only, official SDK, no leaked types | Accepted |
| [0003](0003-conversation-state.md) | Conversation state without a database | Proposed (spike S1) |
| [0004](0004-threat-model.md) | Threat model for a public, anonymous chatbot | Accepted |
| [0005](0005-embedding-model.md) | Embedding model (loader + iframe served by the route handler) | Proposed (spikes S3, S4) |
| [0006](0006-support-matrix-and-versioning.md) | Support matrix and versioning policy | Accepted |
| [0007](0007-tooling.md) | Tooling | Accepted (spike S2 confirms packaging) |
| [0008](0008-ui-customization-and-themes.md) | UI customization layers and built-in themes | Accepted |

## Template

```markdown
# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD

## Context
What forces are at play and why a decision is needed now.

## Decision
What we will do, stated plainly.

## Consequences
What becomes easier, what becomes harder, and what we accept.

## Alternatives considered
The other options and why we didn't pick them.
```
