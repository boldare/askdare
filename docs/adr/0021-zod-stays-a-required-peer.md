# ADR-0021: Zod stays a required peer

- **Status:** Accepted
- **Date:** 2026-11-21
- **Supersedes in part:** [ADR-0020](0020-public-api-cleanup-0-5.md), point 4 ("`zod` becomes an optional peer"). The rest of ADR-0020 stands.

## Context

ADR-0020 planned to make `zod` an optional peer, on the premise that a site using only the script tag and no tools never needs it.

While implementing ADR-0020 (task 0.5-1), we found the premise wrong:
- `defineBot` validates every bot definition with a Zod schema (`src/bot/define-bot.ts`), and so does `defineTheme` (`src/theme/theme.ts`).
- Every askdare site calls `defineBot`, so every site loads `zod` at startup, with or without tools.

## Decision

1. `zod` stays a required peer (`^4.1`), as in ADR-0006.
2. We don't move it to `dependencies`. Tool schemas written by the app must come from the same Zod the library uses for `zodResponsesFunction`, and a peer dependency is what guarantees that.

## Consequences

- Nothing changes for users. The support matrix row for Zod stays as in ADR-0006.
- Making Zod optional would need validation that doesn't depend on Zod (hand-written checks, or a schema-agnostic tool API such as Standard Schema). ADR-0020 already lists that as worth looking at before 1.0.

## Alternatives considered

- **Lazy-load Zod only for tools:** `defineBot` would still need it for validation.
- **Hand-written validation in `defineBot`:** possible, but it duplicates the schema the error messages and docs are built on, for a saving of one peer dependency that every Node.js app with a chatbot can afford.
