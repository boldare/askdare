---
name: typescript-conventions
description: How TypeScript is written in the askdare repository (TS 7, isolatedDeclarations, ESM-only library). Use when writing, reviewing or refactoring any .ts/.tsx file in this repo.
---

# TypeScript conventions for askdare

Distilled from community TypeScript best practices and adapted to this repo: TS 7, an ESM-only library built with tsdown, and Next.js 16. Where generic advice conflicts with these rules, these rules win.

## Compiler settings (do not weaken)

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.
- `verbatimModuleSyntax`: type-only imports use `import type`.
- `isolatedDeclarations` in published packages: **every exported function, const and class member needs an explicit type annotation.** This keeps `.d.ts` generation fast and independent of the compiler API.
- `moduleResolution: "bundler"`, `module: "esnext"`, `target: "es2023"`. Imports use no file extensions.
- Always list `types` explicitly (for example `["node"]`). TypeScript 6 and later default to `types: []`.

## Types

- Use `unknown` instead of `any`, then narrow with type guards or Zod. `any` needs a `// biome-ignore` with a reason.
- Use `as const` objects with union types instead of `enum`.
- Model state with discriminated unions, and use exhaustive `switch` with a `never` check. **Exception:** when mapping OpenAI items or events, unknown variants must be ignored, never thrown on. The SDK adds new variants in minor releases.
- Prefer `readonly` arrays and properties for data that crosses module boundaries.
- Use `satisfies` to check literal configs without widening.
- Avoid non-null assertions (`!`). Handle the `undefined` case.
- Parse at trust boundaries; don't just validate. Request bodies, `postMessage` data, tool arguments and env vars all go through Zod schemas and yield typed values.

## Modules and exports

- Library code uses **named exports only**. Default exports appear only where Next.js requires them (`page.tsx`, `layout.tsx`) and in config files.
- No `export *` barrel files. Each package entry (`src/index.ts`, `src/next/index.ts`) re-exports explicitly, which keeps the public API reviewable.
- One concept per file. File names are `kebab-case.ts`.
- Respect module boundaries (Biome import restrictions): `openai/` is the only importer of `openai`, and `protocol/` is shared by server and client.

## Errors

- Throw `AskdareError` subclasses carrying a stable `code` (`rate_limited`, `budget_exceeded`, `session_expired`, `bot_unavailable`, `upstream_error`, `content_blocked`, `timeout`, `invalid_input`). Messages shown to clients never contain internals.
- Don't introduce a general Result type. Use a discriminated outcome only where failure is an expected value (for example, a tool execution outcome sent back to the model).
- Every `await` on the network must be bounded by an `AbortSignal`, a timeout, or both.

## Tests

- Vitest. Tests sit next to the code as `*.test.ts`.
- No live network calls in unit or integration tests. Use recorded fixtures through MSW.
- Test behaviour through the public or module API, not private helpers.
