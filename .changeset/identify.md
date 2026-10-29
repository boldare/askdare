---
"@boldare/chatdock": minor
---

Signed-in visitors. The site's backend signs a short HS256 JWT with `IDENTITY_SECRET` (`sub`, the bot as `aud`, `iat`, `exp`, optional `name`, `email` and flat claims), and the page calls `chatdock('identify', token)`, or `chatdock('identify', null)` on sign-out. Tools receive the verified user as `context.identity`, instructions as `({ identity })`, and OpenAI gets a hash of the user ID as `safety_identifier`. The token is checked again at every session renewal, so the identity ends with its `exp`. A conversation started while signed in, or adopted at sign-in, can't be resumed, read or deleted by anyone else on the same browser, and the widget keeps each user's conversation apart. A refused or missing token leaves the chat anonymous and logs why. New option `createChatHandler({ identitySecret })`; type `VisitorIdentity`.
