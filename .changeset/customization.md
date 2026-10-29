---
"@boldare/chatdock": minor
---

Add customization levels 1–3. **Texts:** English and Polish dictionaries, `widget.texts` overrides for any key, plural forms, and `locale: 'auto'`, which follows the embedding page's language (else the browser's); server errors now carry a dictionary key, so visitors see them in their language. **AI disclosure:** a note under the message field, with `disclosure.privacyUrl` for a privacy link, or `false` to hide it. **Your own CSS:** `widget.css`, loaded after the theme and outside the library's layer. **Page JavaScript:** `chatdock('configure', { greeting, starters, context })` for per-page texts and page context (sent to the model as untrusted information), `data-launcher="none"` for your own button (focus returns to it on close), and `data-mode="inline"` with `data-target` to place the chat inside an element. The chat panel is a labelled dialog, and every preset passes axe.
