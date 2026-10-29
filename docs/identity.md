# Signed-in visitors

When your site knows who is signed in, the assistant can too: a tool can look up *this* user's orders, and the instructions can greet them by name. The model never decides who the visitor is. Your backend signs a short token, and chatdock checks it. The design is in [ADR-0009](adr/0009-visitor-identity.md).

## 1. Share a secret

Generate a secret and give it to both your site's backend and the chatdock app:

```bash
openssl rand -base64 32   # IDENTITY_SECRET; it must differ from CHAT_SECRET
```

Without `IDENTITY_SECRET` in the chatdock app, identity is off and every visitor is anonymous.

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
  window.chatdock = window.chatdock || function () {
    (window.chatdock.q = window.chatdock.q || []).push(arguments);
  };
  chatdock('identify', '<the token your backend rendered into the page>');
</script>
<script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
```

- On sign-out, call `chatdock('identify', null)`. Single-page apps call `identify` again whenever the user changes.
- The token is checked once, when the chat opens its session. After that the chat keeps the identity until the token's `exp`; sign in again with a fresh token to extend it.
- A token that fails the check leaves the chat anonymous. The browser console says why: `signature`, `expired`, `audience`, `lifetime`, `claims`, `too_large`, `malformed`, or `disabled` when the app has no `IDENTITY_SECRET`.

## 4. Use it

```ts
defineBot({
  // …
  instructions: ({ locale, identity }) =>
    [
      'You are the assistant of our store.',
      identity ? `The visitor is signed in as ${identity.name ?? identity.id}.` : 'The visitor is not signed in.',
      `Reply in ${locale}.`,
    ].join(' '),
  tools: [orderStatus],
});

export const orderStatus = defineTool({
  name: 'get_my_orders',
  description: "The signed-in visitor's recent orders.",
  input: z.object({}),
  execute: async (_input, { identity }) => {
    if (!identity) return { error: 'Ask the visitor to sign in first.' };
    return { orders: await orders.forUser(identity.id) };
  },
});
```

`identity` is `{ id, name?, email?, claims }`, and only ever holds what your backend signed.

## What it protects

- **A conversation belongs to who started it.** A conversation started while signed in can't be resumed, read or deleted by anyone else on the same browser: another user, or the same browser after sign-out. An anonymous conversation continues after the visitor signs in.
- **Abuse is traced to the person.** OpenAI receives a hash of the user's ID as `safety_identifier`, so its abuse checks follow a person across devices.
- **What it doesn't do:** the token is valid until `exp` for whoever holds it, like any bearer token. Keep `exp` short, and keep `IDENTITY_SECRET` in your backend's secrets, never in a page or a repository.
