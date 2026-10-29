# Support

What chatdock is tested with and promises to keep working. The reasoning is in [ADR-0006](adr/0006-support-matrix-and-versioning.md).

## Your app

| | Supported | Not supported |
| --- | --- | --- |
| Node.js | 22 and 24 | 20 and older |
| Next.js | 16.x with the App Router, on the Node.js runtime; Turbopack and `next build --webpack` | Pages Router, Edge runtime, static export |
| React | 19 | 18 |
| zod | 4.1 or later | 3 |
| TypeScript | 5.9, 6.0 and 7.0 | |
| Hosting | Vercel and Heroku | Other hosts that run `next start` should work, but aren't tested |

## Visitors' browsers

The current and previous major versions of Chrome, Edge, Firefox and Safari, on desktop and mobile, at least:

| Browser | Version |
| --- | --- |
| Chrome, Edge | 111 |
| Firefox | 121 |
| Safari (macOS and iOS) | 16.4 |

Older browsers may show the chat with a plainer look or not at all. Dictation also needs a microphone and `MediaRecorder`, which all of these have.

## What a visitor downloads

| | Gzipped | Budget |
| --- | --- | --- |
| The loader (`widget.js`), on every page | about 3 KB | 5 KB |
| The chat itself, when the visitor opens it | about 37 KB, plus 5 KB of styles | 50 KB and 8 KB |
| One theme's fonts, from your app | up to 82 KB | 82 KB |

The build fails when one of these grows past its budget.

## How we keep it working

- **Every change:** lint, types, unit and browser tests, the package checks (publint, are-the-types-wrong), the size budgets, and a snapshot of the published types. A change to the public API has to update the snapshot on purpose and come with a changeset.
- **Every night:** the same against `next@canary` and the newest `openai` SDK, so a breaking release shows up before it reaches you.
- **Every day:** a live test against the real OpenAI API with a cheap model: text, a tool call, file search and an image. It catches retired models and API changes.

## Versions

chatdock is in 0.x. Minor releases may break things; patch releases never do. A removal is announced by a deprecation warning one minor release earlier, and every release lists its changes.
