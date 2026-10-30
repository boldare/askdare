# Signed-in visitors

When your site knows who is signed in, the assistant can too: a tool can look up *this* user's orders, and the instructions can greet them by name. The model never decides who the visitor is. Your backend signs a short token, and askdare checks it. The design is in [ADR-0009](adr/0009-visitor-identity.md).

## 1. Share a secret

Generate a secret and give it to both your site's backend and the askdare app:

```bash
openssl rand -base64 32   # IDENTITY_SECRET; it must differ from CHAT_SECRET
```

Without `IDENTITY_SECRET` in the askdare app, identity is off and every visitor is anonymous.

## 2. Sign the user in on your backend

Sign an HS256 JWT for the signed-in user, every time you render a page for them. With [`jose`](https://github.com/panva/jose):

```ts
import { SignJWT } from 'jose';

const identityToken = await new SignJWT({ name: user.name, email: user.email, plan: user.plan })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(String(user.id))
  .setAudience('support') // the bot ID
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(process.env.IDENTITY_SECRET));
```

Or with nothing but Node.js:

```js
import { createHmac } from 'node:crypto';

function identityToken(user, botId) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: String(user.id), name: user.name, aud: botId, iat: now, exp: now + 3600 };
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  const signature = createHmac('sha256', process.env.IDENTITY_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}
```

Any language with a JWT library works the same way.

| Claim | Required | Notes |
| --- | --- | --- |
| `sub` | yes | Your user ID, up to 256 characters |
| `aud` | yes | The bot ID, so a token for one bot can't be used with another |
| `iat`, `exp` | yes | At most 24 hours apart; an hour or less is best |
| `name`, `email` | no | Shown to your tools and instructions |
| anything else | no | Strings, numbers and booleans reach tools as `claims`, such as a plan or a role. Up to 20, and 2 KB for the whole identity |

## 3. Hand it to the chat

```html
<script>
  window.askdare = window.askdare || function () {
    (window.askdare.q = window.askdare.q || []).push(arguments);
  };
  askdare('identify', '<the token your backend rendered into the page>');
</script>
<script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
```

- On sign-out, call `askdare('identify', null)`. Anything that isn't a token, `undefined` included, signs out too. Single-page apps call `identify` whenever the user changes; repeating the same token costs nothing.
- The chat sends the token with every session request, about every 15 minutes, and the server checks it each time. The identity ends with the token's `exp`; after that the chat continues anonymously until the page calls `identify` with a fresh token. Long-lived pages should do that before `exp`.
- A token that fails the check leaves the chat anonymous. The browser console says why: `signature`, `expired`, `audience`, `lifetime`, `claims`, `too_large`, `malformed`, or `disabled` when the app has no `IDENTITY_SECRET`.

## 4. Use it

```ts
import { defineBot, defineTool } from '@boldare/askdare';
import { z } from 'zod';
import { orders } from './lib/orders'; // your own data access

// Declare tools before the bot that lists them.
export const myOrders = defineTool({
  name: 'get_my_orders',
  description: "The signed-in visitor's recent orders.",
  input: z.object({}),
  execute: async (_input, { identity }) => {
    if (!identity) return { error: 'Ask the visitor to sign in first.' };
    return { orders: await orders.forUser(identity.id) };
  },
});

defineBot({
  // …
  instructions: ({ locale, identity }) =>
    [
      'You are the assistant of our store.',
      // The name is the user's own text: quoted, and one line (askdare removes line breaks).
      identity ? `The visitor is signed in as "${identity.name ?? identity.id}".` : 'The visitor is not signed in.',
      `Reply in ${locale}.`,
    ].join(' '),
  tools: [myOrders],
});
```

`identity` is `{ id, name?, email?, claims }`, and only ever holds what your backend signed. `null` in `name` or `email` counts as missing.

## What it protects

- **A conversation belongs to who started it.** A conversation started while signed in can't be resumed, read or deleted by anyone else on the same browser: another user, or the same browser after sign-out. The browser keeps each user's conversation apart, so signing back in brings it back. An anonymous conversation becomes the user's when they sign in during it.
- **Abuse is traced to the person.** OpenAI receives an HMAC of the user's ID as `safety_identifier`, so its abuse checks follow a person across devices.
- **What it doesn't do:** the token is valid until `exp` for whoever holds it, like any bearer token. Keep `exp` short, and keep `IDENTITY_SECRET` in your backend's secrets, never in a page or a repository.
