# Architecture Decision Records

Short records of decisions that are expensive to reverse. One decision per file, numbered, never renumbered. To change a decision, add a new ADR that supersedes the old one, and update the old one's status.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-shape-and-packaging.md) | Product shape and packaging | Accepted |
| [0002](0002-openai-only-no-leaked-types.md) | OpenAI only, official SDK, no leaked types | Accepted (extended by ADR-0026) |
| [0003](0003-conversation-state.md) | Conversation state without a database | Accepted (spike S1; extended by ADR-0024) |
| [0004](0004-threat-model.md) | Threat model for a public, anonymous chatbot | Accepted |
| [0005](0005-embedding-model.md) | Embedding model (loader + iframe served by the route handler) | Accepted for 0.1 |
| [0006](0006-support-matrix-and-versioning.md) | Support matrix and versioning policy | Accepted (React budget superseded by ADR-0023 and ADR-0028; 0.6 surface added 2026-11-25) |
| [0007](0007-tooling.md) | Tooling | Accepted |
| [0008](0008-ui-customization-and-themes.md) | UI customization layers and built-in themes | Accepted |
| [0009](0009-visitor-identity.md) | Visitor identity with identify() | Accepted |
| [0010](0010-docs-website.md) | Docs website rendered from docs/*.md | Accepted |
| [0011](0011-react-api-and-inline-chat.md) | Headless React API and the chat inside a page | Accepted |
| [0012](0012-server-hooks-and-telemetry.md) | Server hooks for usage and feedback, and an OpenTelemetry add-on | Accepted (amended for `onTranscript`) |
| [0013](0013-browser-events.md) | Chat events in the browser, metadata only | Accepted |
| [0014](0014-runtime-language.md) | Changing the chat's language at runtime | Accepted |
| [0015](0015-reply-options.md) | Reply options and tool UI payloads | Accepted |
| [0016](0016-admin.md) | Admin: a console first, then an add-on with storage | Accepted (`onTranscript` in 0.6) |
| [0017](0017-tool-renderers.md) | Tool results as React components (`toolRenderers`) | Accepted |
| [0018](0018-embed-path.md) | Your own page inside the widget's iframe (`embedPath`) | Accepted |
| [0019](0019-compliance-and-guardrails.md) | Compliance by default, guardrails and bot protection | Accepted |
| [0020](0020-public-api-cleanup-0-5.md) | Public API clean-up for 0.5 | Accepted (point 4 superseded by ADR-0021) |
| [0021](0021-zod-stays-a-required-peer.md) | Zod stays a required peer | Accepted |
| [0022](0022-guardrails-implementation.md) | How guardrails check messages and stream answers | Accepted |
| [0023](0023-human-check-and-react-budget.md) | The human check as built, and a 33 KB budget for the React entry | Accepted (budget superseded by ADR-0028) |
| [0024](0024-conversation-store.md) | Conversations stored outside OpenAI: the `ConversationStore` port | Accepted (spike S7, tasks 1, 2, a2, 3a, e1) |
| [0025](0025-knowledge-index.md) | Retrieval we own: the `KnowledgeIndex` port and the `search_knowledge` tool | Accepted (spike S8, rerun in k2) |
| [0026](0026-provider-path.md) | The provider path: one turn loop, provider profiles, then native adapters | Accepted (spikes S6a, S6b; 0.6 part built) |
| [0027](0027-stream-resume.md) | Resuming an answer after a dropped connection | Accepted (spike S7, r1 to r3b; checked on Vercel) |
| [0028](0028-react-budget-34-kb.md) | A 34 KB budget for the React entry, for Markdown fixes | Accepted |
| [0029](0029-compaction-for-item-stores.md) | Compaction for conversations in our own store | Accepted (spike S9, task 4) |
| [0030](0030-handoff.md) | Handoff to a human | Proposed |
| [0031](0031-forms-and-leads.md) | Forms in the chat and leads | Proposed |

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
