# ADR-0008: UI customization layers and built-in themes

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Users want two things at once:
- Polished defaults for the "lazy" path.
- Unlimited freedom to change the look.

Hundreds of configuration options would freeze the library's API and still never be enough.

## Decision

### Customization layers

Simple changes are configuration; hard changes are code. Logic (streaming, security, limits, protocol) always stays in the library.

| Layer | Mechanism | Version |
|---|---|---|
| 1. Configuration | `widget: {...}` in `defineBot`: typed, Zod-validated | 0.1 |
| 2. Custom CSS | `widget.css` injected into the iframe. Library styles live in `@layer chatdock`, so user CSS wins without `!important`. Stable parts via `[data-cd-part]` plus state attributes. The launcher is stylable from host CSS via `::part`. | 0.1 |
| 3. Host page JavaScript | `chatdock('open' \| 'close' \| 'configure')`, `data-launcher="none"` for a custom trigger, `data-mode="inline"` | 0.1 |
| 4. Headless React | `@boldare/chatdock/react`: `useChat()`, primitives `<Chat.*>`, slots, `toolRenderers` | 0.2 |
| 5. Eject | `npx @boldare/chatdock add ui` copies the default UI source into the user's repo, shadcn-style | 0.2 |

### Rules

- **Two kinds of configuration.** Server config (model, instructions, tools, limits, secrets) and public config (`widget`) have separate types. `GET /config` serializes only the public part, and a CI test checks that no secret leaks through it.
- **About 15 semantic tokens** (`--cd-*`); the rest of the palette is derived. Each derived accent is checked for contrast.
- **UI built as layers from day one:** a headless core, primitives and a default skin. Layers 4 and 5 then only *expose* existing code.
- **Runtime overrides are allowlisted.** `chatdock('configure')` accepts only texts, starters and page context. Page context is off unless a bot opts in, and then travels in the visitor's own turn (user role) with a length cap, never in `instructions` (changed in step 4.1 after the security review: instructions outrank visitor text).
- **Accessibility cannot be configured away.** Dev mode warns about weak contrast, and the focus ring is always visible.

### Built-in presets

There are four presets, each with a light and a dark variant. Every preset is built **only on the public styling API**, which proves that layers 1 and 2 are enough, and each can be extended with `defineTheme({ extends })`.

| Preset | Character |
|---|---|
| **Halo** (default) | Clean, white to ice blue, frosted orb, centered greeting with icon chips |
| **Aura** | Voice-first soft glass: pastel gradient mesh, iridescent orb, gradient composer border |
| **Sage** | Calm and editorial: sage neutrals, persona card with an "Online" pill, black pill CTAs |
| **Care** | Trust-first and structured: indigo and lavender, mascot, capability checklist, Atkinson Hyperlegible, AAA text contrast |

Each preset is a set of tokens plus defaults for these component variants:
- `avatar`
- `welcome` (layout)
- `launcher` (style)
- `bubbles`
- `surface`
- `density`
- `composer`

Implementation (step 3.6): 17 tokens (11 colors, the backdrop and orb paint, two font families, base size, radius); see [Themes](../themes.md). The server renders a bot's theme as a content-hashed stylesheet (the iframe CSP forbids inline styles) and sets the variants as `data-cd-*` attributes on the iframe document. The requested bot's launcher look is inlined into `widget.js?bot=<id>` (only that bot's, so the script never lists other bots), and the launcher is drawn right on first paint without another request.

### Quality bar

- **Contrast validator in CI:** AA for every token pair, and AAA for text in Care.
- **Fonts:** OFL-licensed only, self-hosted, loaded lazily for the chosen preset, at most 80 KB per preset.
- **The orb** is pure CSS: no WebGL, at most 3 KB.
- **Motion** respects `prefers-reduced-motion`.
- **State gallery** (`examples/starter/app/gallery`) feeds visual regression tests: 4 presets × light and dark × 3 widths.
- **A product designer reviews the presets** before the release candidate.

## Consequences

- The styling contract (tokens, parts, dictionary keys, the JS API) is public and versioned (ADR-0006), so it must stay small and semantic.
- Inspirations set the mood only. The designs are original.
