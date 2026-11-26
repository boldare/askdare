---
'@boldare/askdare': minor
---

Visitors who come back to a long conversation can now scroll up to read all of it, in the widget, in the chat inside a page and with the headless API. The chat still opens on the latest page of the conversation, and loads older pages one at a time from the cursor that `POST /history` returns.

- **The default look** shows a "Show earlier messages" button at the top of the conversation. It loads as the visitor scrolls up to it, and works as a button from the keyboard. The older messages go in above without moving what the visitor was reading, and screen readers hear "Earlier messages loaded." Focus stays on the button, in view; once the start is reached and the button goes away, the oldest message takes focus.
- **Headless:** `state.earlier` (`'more'`, `'loading'` or `'none'`, new type `Earlier`) and the action `loadEarlier()`. The new primitive `LoadEarlier` renders the button (part `load-earlier`, with `data-loading` while a page loads). `Messages` keeps the visitor's place whatever control loads older messages.
- **New texts:** `history.earlier`, `history.loading`, `history.loaded` and `error.earlier`, in every built-in language.
- A page that fails to load shows `error.earlier` and can be tried again. A cursor the server refuses ends paging until the chat reloads. Starting over or signing in drops the cursor.

See [React: Long conversations](https://github.com/boldare/askdare/blob/main/docs/react.md#long-conversations).
