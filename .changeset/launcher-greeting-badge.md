---
'@boldare/askdare': minor
---

Adds a greeting next to the closed launcher and an unread badge on it, both drawn by the loader (ADR-0033).

- **`widget.launcherGreeting`** (`true` or `{ delaySeconds }`, default off) shows a short greeting next to the closed launcher after the delay (5 seconds by default). The text is `texts['launcher.greeting']`; the default says it is an AI assistant, and your own should too. Clicking it opens the chat; × and Escape dismiss it and focus the launcher. It never takes focus and isn't a live region. It shows only with askdare's own launcher, only if the chat hasn't been opened on the page, and only once per browser session: dismissing it or opening the chat writes `askdare:<bot>:greeted` to `sessionStorage` on your site. Nothing is written when it only shows, and with storage blocked it doesn't show. `data-greeting="off"` on the script tag turns it off for a page. Style it with `::part(greeting)`.
- **Two new events** for `askdare('on')`: `greeting.shown` and `greeting.dismissed`.
- **The unread badge:** answers that arrive while the chat is closed are counted on the launcher (`9+` above nine), and opening the chat clears the count. The launcher's name gains `launcher.unread` ("new messages"). Restyle the badge with `::part(launcher)::after`.
- The loader is 5,284 B gzipped (budget 5,632 B). A bot without a greeting ships none of its texts.
