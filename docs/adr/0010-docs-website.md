# ADR-0010: Docs website rendered from docs/*.md

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The guides in `docs/` ship inside the npm package and feed `llms.txt`, so they must stay plain Markdown that reads well on GitHub and in `node_modules`. Before the release candidate, the askdare website (`site/`) also needs a docs section: navigation, search, a table of contents, highlighted code with a copy button, a dark scheme, phones, and links to the previous and next page and to the source on GitHub. It should look like the rest of the site, which is plain CSS in Boldare's Aura style.

We checked [Fumadocs](https://fumadocs.dev/) first (versions as of 2026-10-30):

- `fumadocs-ui` and `fumadocs-core` 16.17.9 support Next.js 16 and React 19.2.
- The UI needs Tailwind CSS 4 (through `@fumadocs/tailwind`), plus Radix UI, `motion`, `lucide-react` and `next-themes`. Content comes through `fumadocs-mdx`, which compiles with MDX and esbuild.
- It ships a new patch release every few days.

Our docs contain no raw HTML outside code, so they need nothing MDX adds.

## Decision

`site/` renders `docs/*.md` (and the ADRs) with its own small pipeline, at build time:

- **Markdown:** `unified` with `remark-parse`, `remark-gfm`, `remark-rehype` and `rehype-slug` (GitHub's heading IDs, so anchors match GitHub). Highlighting uses `@shikijs/rehype` with a light and a dark theme.
- **No raw HTML, no `dangerouslySetInnerHTML`:** HTML in Markdown is dropped. The syntax tree becomes React elements with `hast-util-to-jsx-runtime`.
- **Links:** a link to another published guide becomes `/docs/<page>`. Any other link that leaves `docs/` points to the file on GitHub, as `copy-docs.mjs` does for the package.
- **Search:** a JSON index of every section (page, heading, text), generated at build time and searched in the browser. With about 25 pages, this needs no search library.
- **Pages** are generated statically (`generateStaticParams`, `dynamicParams = false`), so the site reads the files only at build time. `live-testing.md` is for contributors and isn't published, as in the package.
- **Look:** plain CSS scoped to `.docs`, with the home page's tokens. The docs pages carry the "askdare docs" chat, which answers from the same files once they are synced to a vector store (`kb sync`).

## Consequences

- No Tailwind, no MDX, no component library: about ten small, mature dependencies, all used at build time except the search box and the copy button.
- The docs render the same Markdown as GitHub and the package, so one source of truth stays honest.
- We own the sidebar, search and table of contents: a few hundred lines that we maintain ourselves.
- Interactive components inside docs (tabs, live examples) would need a new decision. MDX can be added later without moving the files.

## Alternatives considered

- **Fumadocs.** A good fit for a React docs site, but it brings Tailwind and a component stack to a plain-CSS site, and its look would need overriding to match the home page. Its fast release pace would also be a steady stream of updates for a private site.
- **Nextra and other MDX-first frameworks.** These need MDX, too, and we don't need it.
- **Pagefind for search.** It indexes built HTML after `next build`, which adds a post-build step and a binary. An index generated from the Markdown is simpler at this size.
