---
'@boldare/askdare': patch
---

Answers render more Markdown correctly: the bundled `marked` is updated to 18.2.1, with fixes for block quotes and lists with lazy lines, tabs, link destinations, bracket escapes in code spans, task-list markers and trailing blank lines in fenced code. `@boldare/askdare/react` grows by about 0.5 KB gzipped; its size budget is now 34 KB (ADR-0028).
