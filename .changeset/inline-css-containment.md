---
'@boldare/askdare': patch
---

A bot's `widget.css` can no longer reach the host page when the chat is inside a page. A stray `}` used to close the `@scope` block early, so a typo like `a { color: red } } body { display: none }` applied `body { display: none }` to the whole page. Stray closing braces are now dropped, and unclosed blocks or strings are closed, so every rule stays scoped to the chat.
