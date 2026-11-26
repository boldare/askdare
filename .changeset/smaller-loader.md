---
'@boldare/askdare': patch
---

The loader (`widget.js`) is smaller, 4,721 instead of 5,052 bytes gzipped, with the same behavior: its styles are minified at build time, and the server always inlines a launcher look, the default one for a script tag with only `data-bot`. The launcher now also appears on pages that enforce Trusted Types (`require-trusted-types-for 'script'`): its icons are built as SVG nodes instead of from HTML.
