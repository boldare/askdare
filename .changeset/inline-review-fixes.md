---
'@boldare/askdare': patch
---

Fixes in the chat inside a page and its default look:

- An answer or a transcript returns focus to the message field only when focus was in the chat or nowhere, never from the page's own fields, and without scrolling the page. `actions.focus()` still always moves it.
- Ratings of one answer go out one at a time: quick 👍 then 👎 ends with what the server took, and a failed one goes back to the last rating it confirmed.
- A comment after 👎 stays in its form until it is sent, so a failed send no longer loses the text.
- No new dictation starts while the last one is being transcribed.
- `<Root>` unmounting stops the answer being streamed and the uploads still running.
- `Composer`: an `onSubmit` that calls `preventDefault()` takes the message over, Enter in the `Input` goes through `onSubmit` too, and an `onPaste` that prevents the default keeps the files out.
- Escape outside the chat is left to the page also with `headingLevel={1}`, and Escape that a handler already used is ignored. The question before a new conversation is modal only in the iframe.
- The default look's stylesheet styles only the chat inside `DefaultChat`, never a headless chat in the same document.
- The rating buttons and the question after 👎 scroll into view at the end of the conversation, and messages no longer re-render on every change of the chat.
