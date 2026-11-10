---
'@boldare/askdare': minor
---

New entry `@boldare/askdare/react`: the chat inside a page of your own Next.js app, without an iframe. `Root` runs one bot's chat, `DefaultChat` is the widget's look ready to place, and the hooks (`useChat`, `useChatState`, `useMessage`) and primitives (`Messages`, `MessageList`, `Message`, `MessageText`, `Composer`, `Input`, `Send` and the rest) let you write your own markup on the same parts and tokens. `getChatConfig({ bots, bot })` from `@boldare/askdare/next` gives a Server Component the public configuration to pass to `Root`. React 19 is a new optional peer dependency; the script-tag widget needs nothing new. The chat talks only to its own origin, and a page that renders it shares its scripts' access to the conversation: on sites that run scripts they don't trust, keep the iframe widget.
