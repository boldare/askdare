# Architecture Decision Records

Short records of decisions that are expensive to reverse. One decision per file, numbered, never renumbered. To change a decision, add a new ADR that supersedes the old one, and update the old one's status.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-shape-and-packaging.md) | Product shape and packaging | Accepted |
| [0002](0002-openai-only-no-leaked-types.md) | OpenAI only, official SDK, no leaked types | Accepted |
| [0003](0003-conversation-state.md) | Conversation state without a database | Accepted (spike S1) |
| [0004](0004-threat-model.md) | Threat model for a public, anonymous chatbot | Accepted |
| [0005](0005-embedding-model.md) | Embedding model (loader + iframe served by the route handler) | Accepted for 0.1 |
| [0006](0006-support-matrix-and-versioning.md) | Support matrix and versioning policy | Accepted |
| [0007](0007-tooling.md) | Tooling | Accepted |
| [0008](0008-ui-customization-and-themes.md) | UI customization layers and built-in themes | Accepted |
| [0009](0009-visitor-identity.md) | Visitor identity with identify() | Accepted |
| [0010](0010-docs-website.md) | Docs website rendered from docs/*.md | Accepted |
| [0011](0011-react-api-and-inline-chat.md) | Headless React API and the chat inside a page | Accepted |
| [0012](0012-server-hooks-and-telemetry.md) | Server hooks for usage and feedback, and an OpenTelemetry add-on | Accepted |
| [0013](0013-browser-events.md) | Chat events in the browser, metadata only | Accepted |
| [0014](0014-runtime-language.md) | Changing the chat's language at runtime | Accepted |
| [0015](0015-reply-options.md) | Reply options and tool UI payloads | Accepted |
| [0016](0016-admin.md) | Admin: a console first, then an add-on with storage | Accepted |

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
