# Embedding the chat

The chat runs in your Next.js app and shows up on any page that loads one script from it: pages of the app itself, or any other website. The script draws the chat button in a shadow root and opens the chat in an iframe that your app serves. The design is in [ADR-0005](adr/0005-embedding-model.md).

## The snippet

Paste one tag into the HTML of every page that should show the chat:

```html
<script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
```

- `https://app.example.com` is where your Next.js app runs.
- `/api/chat` is the route that `init` created.
- `support` is the `id` of the bot in `askdare.config.ts`.

The site must be in the bot's `security.allowedOrigins`. Pages of the app itself are always allowed.

Load it as a plain script. Don't add `type="module"`, `crossorigin` or `integrity`: the loader finds its settings through its own `<script>` tag, and `widget.js` is served without CORS headers.

The loader passes the `lang` of the page's `<html>` to the chat. A bot with `locale: 'auto'` follows it; see [Styling](styling.md#1-configuration). To follow later changes of `lang` too, add `data-follow-lang`.

## Script tag attributes

The loader reads these five attributes from its own `<script>` tag, and no others:

| Attribute | Value | Effect |
| --- | --- | --- |
| `data-bot` | A bot ID | The bot to load. Wins over `?bot=` in `src`. |
| `data-mode` | `inline` | The chat fills the element that `data-target` names instead of floating over the page. Any other value is ignored. |
| `data-target` | A CSS selector, such as `#chat` | The element for an inline chat. Read only with `data-mode="inline"`. |
| `data-launcher` | `none` | No chat button. Open the chat from your own button with `askdare('open')`. Ignored for an inline chat. |
| `data-follow-lang` | No value | The chat follows the page's `<html lang>` when it changes, for a site that switches language without a page load. Only for a bot with `locale: 'auto'`; see [Texts](texts.md#switching-the-language-on-the-page). |

An inline chat waits until the page has parsed its target element, so the script can sit in `<head>`. When no element matches the selector, the console says `[askdare] No element matches #chat.` and the chat floats instead. Without `data-target`, it floats too.

Examples of both modes are in [Styling](styling.md#3-page-javascript).

### `?bot=` or `data-bot`

Both name the bot, and `data-bot` wins when both are set. They differ in one way:

- **`?bot=`** also brings the bot's button. Your app builds `widget.js` for the bot in `?bot=`, with its colors, button style and texts.
- **`data-bot`** alone gets a default button: a blue chat icon with English texts.

Use `?bot=`. If you also set `data-bot`, give it the same ID; with a different one, the button falls back to the default look.

Without either, nothing loads, and the console says `[askdare] Load the widget as widget.js?bot=<bot id>.`

## Several bots in one app

One app can serve several bots, for example one for support and one for sales:

```ts
// askdare.config.ts
import { defineBot } from '@boldare/askdare';

export const bots = [
  defineBot({
    id: 'support',
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: 'You answer support questions about our product.',
    security: { allowedOrigins: ['https://www.example.com'] },
  }),
  defineBot({
    id: 'sales',
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: 'You answer questions about plans and prices.',
    security: { allowedOrigins: ['https://shop.example.com'] },
  }),
];
```

- The one route serves every bot in `bots`, through `createChatHandler({ bots })`. You don't need a second route.
- A bot ID uses 1 to 48 lowercase letters, digits or dashes, and starts with a letter or digit. Two bots with the same ID fail with `[askdare] Duplicate bot id "sales".`
- Each bot has its own `allowedOrigins`, look and limits.
- Each page picks its bot with `?bot=`: `widget.js?bot=support` on one site, `widget.js?bot=sales` on another.

A page shows one chat. The loader starts once per page load, and a second snippet on the same page does nothing, for the same bot or another one. In an app that navigates without full page loads, the first chat stays until the next full page load.

## Your site's Content Security Policy

If the site that embeds the chat sends a Content Security Policy, allow your app's origin where the loader needs it:

| Directive | Add | Why |
| --- | --- | --- |
| `script-src` | Your app's origin | The page loads `widget.js` from your app. |
| `frame-src` | Your app's origin | The chat is an iframe of `/api/chat/embed/<bot>` on your app. Without `frame-src`, browsers use `child-src`, then `default-src`. |
| `img-src` | Your app's origin, or `data:` | Only for the `pill` button with a bot `avatar`: a path loads from your app, a data URL needs `data:`. When the image is blocked, the button shows the bot's initials. |

For example, with the chat at `https://app.example.com`:

```text
Content-Security-Policy: script-src 'self' https://app.example.com; frame-src https://app.example.com; img-src 'self' https://app.example.com
```

You don't need to change anything else:

- **`style-src`:** the button's styles are a constructed stylesheet in its shadow root, and its colors are set through the CSSOM. A Content Security Policy doesn't block either, so you don't need `'unsafe-inline'`. Only Safari before 16.4, older than the [supported browsers](support.md#visitors-browsers), falls back to a `<style>` element, which a strict `style-src` blocks.
- **`font-src`:** the button uses the system font. The chat's own fonts load inside the iframe.
- **`connect-src`:** the loader sends no requests of its own. The iframe talks to your app under the chat's own policy.

Your own inline scripts follow your policy as usual. Under a policy without `'unsafe-inline'`, give the `askdare(…)` queue script a nonce or hash, or move it into a file. Attach your button's click handler with `addEventListener` instead of an `onclick` attribute.

Dictation needs the microphone. If your site sends `Permissions-Policy: microphone=()`, see [Voice input](voice-input.md#embedding).

## What your app sends back

The chat page, `/api/chat/embed/<bot>`, answers with these headers:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' <allowedOrigins>` |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=()`, or `microphone=(self)` for a bot with `voice` |
| `Referrer-Policy` | `strict-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Cache-Control` | `no-store` |

`frame-ancestors` decides who may embed the chat: `'self'`, which is your app, plus the bot's `security.allowedOrigins`. With `allowedOrigins: ['https://www.example.com']`, the header ends in `frame-ancestors 'self' https://www.example.com`. Browsers enforce it, so the list holds even if someone copies the snippet.

`widget.js` is served with `Cache-Control: public, max-age=300, stale-while-revalidate=86400`, or `no-cache` under `next dev`. A new button look can take a few minutes to show on other sites.

Don't let anything in front of the route add `X-Frame-Options` or a second Content Security Policy to the chat page. A second policy applies on top of askdare's and can block the sites on your list. `doctor` reports both; see also [Deployment](deployment.md#behind-another-proxy-or-cdn).

### Allowed origins

Each entry in `security.allowedOrigins` is one exact origin:

- `https://` plus the host, and a port if the site uses one, such as `https://www.example.com`.
- `http://` only for `localhost`, `127.0.0.1`, `[::1]` and `*.localhost`.
- No path, no trailing slash and no wildcard.
- Up to 50 per bot.

`https://example.com` and `https://www.example.com` are different origins; list both if both serve pages. `defineBot` rejects anything else with `must be an https origin like https://www.example.com (no path or wildcard; http only for localhost)`.

### On a site that isn't allowed

The browser refuses to show the chat page inside the site. The loader waits for the chat to say it's ready. After about 8 seconds, the panel shows "The chat couldn’t load. Please try again later." (the `launcher.unavailable` text, in the visitor's language), and the console says:

```text
[askdare] The chat "support" didn't load on https://www.example.com. Is this origin in the bot's security.allowedOrigins? Check with: npx @boldare/askdare doctor --origin https://www.example.com
```

The 8 seconds start when the visitor first opens the chat, or when the page loads for an inline chat. The same happens when the bot ID doesn't exist in the app, or when something in front of the route blocks the chat page.

Check a site against the running app:

```bash
npx @boldare/askdare doctor --origin https://www.example.com
```

For a deployed app, add `--url https://app.example.com --env-file .env.production.local`. See [Command line](cli.md#doctor).

## Test on a second origin locally

Pages of the app itself are always allowed, so `http://localhost:3000` never tests `allowedOrigins`. Use a second origin, for example `http://127.0.0.1:4000`, against the app on `http://localhost:3000`:

1. Add `http://127.0.0.1:4000` to the bot's `security.allowedOrigins`, or to `ASKDARE_ALLOWED_ORIGINS` in `.env.local` (see [Staging and production](#staging-and-production)). Restart `next dev`.
2. Create a test page, for example `embed-test/index.html`:

   ```html
   <!doctype html>
   <html lang="en">
     <head>
       <meta charset="utf-8">
       <title>Embed test</title>
     </head>
     <body>
       <h1>Embed test</h1>
       <script src="http://localhost:3000/api/chat/widget.js?bot=support" async></script>
     </body>
   </html>
   ```

3. Serve the folder on port 4000 with any static file server, for example:

   ```bash
   python3 -m http.server 4000 --bind 127.0.0.1 --directory embed-test
   ```

4. Open `http://127.0.0.1:4000` and check it:

   ```bash
   npx @boldare/askdare doctor --origin http://127.0.0.1:4000
   ```

Keep the test origin out of production. Putting it only in `.env.local` does that.

## Next.js apps

In your own Next.js app, load the chat with `next/script` in the root layout. This is what `init` adds:

```tsx
// app/layout.tsx
import Script from 'next/script';
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="/api/chat/widget.js?bot=support" strategy="afterInteractive" />
      </body>
    </html>
  );
}
```

- `strategy="afterInteractive"` loads the script after React has hydrated the page, so React never finds the loader's elements in `<body>`.
- The path is relative: the app serves the script itself.
- `next/script` passes `data-*` attributes on to the tag, for example `data-launcher="none"`.

An inline chat inside a React app has a hydration caveat. [Styling](styling.md#3-page-javascript) explains it.

In the Next.js app that serves the chat, you can also render it without an iframe, as React components in your own pages: see [The chat inside your page](react.md).

## Your own page in the iframe

By default the widget's iframe shows askdare's own page, built with the default look: it needs nothing from you and nothing on your side can break it. A bot can show a page of your app there instead, so the widget on every site that embeds it uses your own components and draws your [tool cards](react.md#tool-cards) ([ADR-0018](adr/0018-embed-path.md)). The snippet on those sites stays the same.

**1. Point the bot at a page.** A path of your app, outside the chat route:

```ts
// askdare.config.ts
defineBot({ id: 'support', /* … */ embedPath: '/askdare/support' });
```

The chat route now redirects the iframe there, with `lang` (for a bot with `locale: 'auto'`) and `mode=inline` (for an inline chat) in the query.

**2. Give the page its own root layout.** Put it in a route group with its own `<html>` and `<body>`, so nothing of your site (its header, navigation, fonts, analytics or chat widget) renders or runs inside the widget on other sites. With a group of its own, your other pages move into a group too, such as `app/(site)/`:

```tsx
// app/(askdare)/layout.tsx
import './frame.css'; // html, body { height: 100%; margin: 0 }

export default function FrameLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

**3. Render the chat with `EmbedRoot`.** The page reads its configuration in a Server Component; a client component renders it:

```tsx
// app/(askdare)/askdare/support/page.tsx
import { getEmbedConfig } from '@boldare/askdare/next';
import { Suspense } from 'react';
import { bots } from '@/askdare.config';
import { FramedChat } from './framed-chat';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: Search }) {
  // With Cache Components (as in the starter), the request's data is read inside Suspense.
  return (
    <Suspense>
      <Chat searchParams={searchParams} />
    </Suspense>
  );
}

async function Chat({ searchParams }: { searchParams: Search }) {
  const config = getEmbedConfig({ bots, bot: 'support', searchParams: await searchParams });
  return <FramedChat config={config} />;
}
```

```tsx
// app/(askdare)/askdare/support/framed-chat.tsx
'use client';
import { type EmbedChatConfig, EmbedRoot } from '@boldare/askdare/embed';
import * as Chat from '@boldare/askdare/react';
import { toolRenderers } from '@/components/tool-cards';

export function FramedChat({ config }: { config: EmbedChatConfig }) {
  return (
    <EmbedRoot config={config} toolRenderers={toolRenderers}>
      <Chat.DefaultChat className="framed-chat" />
    </EmbedRoot>
  );
}
```

`EmbedRoot` connects to the loader on the embedding site exactly as askdare's own page does: `askdare('identify')`, `configure`, `on`, opening, closing and language switches all work. Inside it, `DefaultChat` is the page's main landmark with an `h1`, and shows a close button. Instead of `DefaultChat`, you can use an [ejected copy](react.md#eject-the-default-look), which behaves the same, or [your own markup](react.md#your-own-markup), where `useFrame()` gives you the close action for your own button.

**4. Send the iframe page's headers.** Without them, any site could frame the page, and the microphone would follow your app's policy. Set them in `proxy.ts`, per request:

```ts
// proxy.ts
import { embedPageHeaders } from '@boldare/askdare/next';
import { type NextRequest, NextResponse } from 'next/server';
import { bots } from './askdare.config';

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const bot = bots.find((item) => item.embedPath === request.nextUrl.pathname);
  for (const { key, value } of bot ? embedPageHeaders({ bots, bot: bot.id }) : []) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = { matcher: '/askdare/:bot' };
```

Not `headers()` in `next.config.ts`, unless the allowed origins are written in your code: Next.js evaluates it when the app is built, so origins from the environment where it runs would be missing, and the widget wouldn't open on those sites. If you already have a `proxy.ts` that signs visitors in or rewrites paths (i18n), leave the page's path out of what it does: the page must answer without a redirect.

**5. Check it.** Run `npx @boldare/askdare doctor --origin https://www.example.com`. It follows the redirect and checks the page: it answers without a redirect, renders `EmbedRoot`, may be framed by the app and every allowed origin and by nothing else, and keeps the microphone off unless the bot has voice input.

Things to know:
- **The page runs your scripts with the chat's origin,** as [the chat inside your page](react.md) does: they could read the visitor's session. Load no third-party scripts on it; the root layout of its own keeps your site's out.
- **The page is rendered per request** (it reads its search parameters). Don't cache it.
- **It opens a moment later** than askdare's own page: one redirect, and your page hydrates before the chat connects. Until then, the Send button stays off.
- **In an app with `basePath`** in `next.config.ts`, include that prefix in `embedPath`.

## Staging and production

Each environment usually embeds the chat on different sites. Read the list from an environment variable, for example `ASKDARE_ALLOWED_ORIGINS`, split on commas:

```ts
// askdare.config.ts
import { defineBot } from '@boldare/askdare';

// Sites that may embed the chat, comma-separated. The app's own origin is always allowed.
const allowedOrigins = (process.env.ASKDARE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const bots = [
  defineBot({
    id: 'support',
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: 'You are the assistant on our website.',
    security: { allowedOrigins },
  }),
];
```

Then set it per environment:

```bash
# Production
ASKDARE_ALLOWED_ORIGINS=https://www.example.com,https://shop.example.com
# Staging
ASKDARE_ALLOWED_ORIGINS=https://staging.example.com
# .env.local
ASKDARE_ALLOWED_ORIGINS=http://127.0.0.1:4000
```

- askdare doesn't read this variable itself; your config does. The name is only a convention.
- Without the variable, only the app's own pages may embed the chat.
- `defineBot` checks every entry, so an invalid one stops the build or the app's start.
- Set it in your host's settings for every environment, then deploy. Check each site with `doctor --origin`.

## Page JavaScript

The page can open and close the chat, sign the visitor in, and set a greeting, suggestions, page context and the language per page: `askdare('open')`, `askdare('close')`, `askdare('toggle')`, `askdare('identify', token)` and `askdare('configure', { … })`. See [Styling](styling.md#3-page-javascript) and [Signed-in visitors](identity.md). To hear what happens in the chat, for analytics, use `askdare('on', type, listener)`: see [Chat events](events.md).
