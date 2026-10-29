---
"@boldare/chatdock": minor
---

Signed-in visitors. The site's backend signs a short HS256 JWT with `IDENTITY_SECRET` (`sub`, the bot as `aud`, `iat`, `exp`, optional `name`, `email` and flat claims), and the page calls `chatdock('identify', token)`, or `chatdock('identify', null)` on sign-out. Tools receive the verified user as `context.identity`, instructions as `({ identity })`, and OpenAI gets a hash of the user ID as `safety_identifier`. A conversation started while signed in can't be resumed, read or deleted by anyone else on the same browser. A refused token leaves the chat anonymous and logs why. New option `createChatHandler({ identitySecret })`; type `VisitorIdentity`.
