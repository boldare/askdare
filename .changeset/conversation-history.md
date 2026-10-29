---
"@boldare/chatdock": minor
---

The widget restores the visitor's conversation after a page reload (from the OpenAI Conversations API) and offers "Start a new conversation", which deletes the old one. New endpoints: `POST /history` and `DELETE /conversation`, both limited to the visitor who owns the conversation.
