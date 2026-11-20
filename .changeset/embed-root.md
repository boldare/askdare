---
'@boldare/askdare': minor
---

Your own page in the widget's iframe (ADR-0018). A new entry, `@boldare/askdare/embed`, exports `EmbedRoot`: render it on the page a bot's `embedPath` points to, with `getEmbedConfig`, and put `DefaultChat`, an ejected copy or your own markup inside. It connects to the loader on the embedding site exactly as askdare's own page does (identity, `configure`, events, closing, language switches), so the widget on every site uses your components and draws your `toolRenderers`. Inside `EmbedRoot`, `DefaultChat` and an ejected copy of it own the document: an `h1` and a close button. A new hook, `useFrame()`, gives your own markup the same close action. The loader answers a new `askdare:hello` from its own iframe, so a page that hydrates after its load event still connects. Send the page's headers from `proxy.ts` with `embedPageHeaders`; the guide is in Embedding.
