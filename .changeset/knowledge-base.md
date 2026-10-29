---
"@boldare/chatdock": minor
---

Add a knowledge base. `chatdock kb sync <folder>` makes an OpenAI vector store mirror a folder of documents (Markdown, text, PDF, Word, PowerPoint, HTML, JSON): it uploads new and changed files, retags renamed titles or URLs, deletes removed files, and does nothing on a second run. Each file's title and page URL come from Markdown front matter or `chatdock.kb.json`. Set `knowledge: { vectorStoreId }` in `defineBot` and the model searches those documents with OpenAI file search; answers cite their sources as links to your pages, live and after a reload. The widget shows "Searching documents…" while it searches.
