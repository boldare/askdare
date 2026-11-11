# The chat inside your page (React)

`@boldare/askdare/react` renders the chat in a page of your own Next.js app, as React components instead of an iframe. You get the widget's look ready to place, or hooks and primitives to write your own markup ([ADR-0011](adr/0011-react-api-and-inline-chat.md)). Streaming, limits and security stay in the library either way.

| You want | Use |
| --- | --- |
| A chat button on any site, also sites that aren't yours | The script-tag widget ([Embedding](embedding.md)) |
| The chat as part of a page of your Next.js app | `DefaultChat`, below |
| Your own markup and CSS | [The primitives](#your-own-markup) |
| To change the default components themselves | [`add ui`](#eject-the-default-look) |

**Before you start:**

- It needs React 19 and the same app that serves the chat route. The chat talks only to its own origin: it can't be used from another site. For that, use the widget.
- **A chat inside a page is as safe as the page.** Scripts on the page can read the conversation and the visitor's session, which the widget's iframe keeps from them. On pages that run scripts you don't trust (ads, tag managers with third-party tags), keep the widget.

## Set up

You need the chat route from [Getting started](getting-started.md). Then:

**1. Read the bot's public configuration in a Server Component** and render the chat with it:

```tsx
// app/help/page.tsx
import { getChatConfig } from '@boldare/askdare/next';
import { DefaultChat, Root } from '@boldare/askdare/react';
import { bots } from '@/askdare.config';

export default function HelpPage() {
  const config = getChatConfig({ bots, bot: 'support' });
  return (
    <Root config={config}>
      <DefaultChat className="help-chat" />
    </Root>
  );
}
```

**2. Give the chat a height.** It fills the element it is in:

```css
.help-chat { height: 640px; }
```

That is all: the components are client components already, and the chat loads its stylesheets from the chat route, so there is no CSS to import and nothing to configure in your bundler.

`getChatConfig(options)` returns only what browsers may see: texts, the theme's name and the URLs of the stylesheets. Never the model, instructions, tools or keys.

| Option | Default | Meaning |
| --- | --- | --- |
| `bots` | required | The same bots as in `createChatHandler`. |
| `bot` | required | The ID of the bot to show. |
| `basePath` | `/api/chat` | The path of the chat route, if you changed it in `createChatHandler`. |
| `locale` | `en` | The page's language, for a bot with `locale: 'auto'`. A bot with a fixed locale keeps it. |

## `Root`

`Root` runs one bot's chat for the components inside it. It renders no element of its own.

| Prop | Meaning |
| --- | --- |
| `config` | From `getChatConfig`. A different bot, route or language starts another chat. |
| `identity` | The signed-in visitor: a token from your backend, as for `askdare('identify')`. See [below](#signed-in-visitors). |
| `greeting`, `starters` | This page's greeting and up to 4 suggested questions, instead of the bot's. |
| `context` | A short description of the page for the assistant, up to 1,000 characters. Only for a bot with `pageContext: true`. |
| `onEvent` | Called with what happens in the chat, such as a message sent or an answer rated, for analytics. Metadata only. A new function doesn't restart the chat. See [Chat events](events.md). |

`greeting`, `starters` and `context` are the same as in `askdare('configure')` and are checked the same way ([Styling](styling.md#3-page-javascript)).

### Signed-in visitors

Pass the identity token your backend signs ([Signed-in visitors](identity.md)):

```tsx
<Root config={config} identity={token}>
```

- **To sign a visitor out, pass `identity={null}`.** Leaving the prop out, or passing `undefined`, keeps whoever is signed in. In a single-page app, a `Root` that stays mounted across a sign-out must get `null`.
- **A page that renders a token must not be cached.** The token is in the page's HTML, so render the page per request (for example by reading `cookies()`), and never serve it from a shared cache.

## `DefaultChat`

The widget's look: header, conversation, message field, attachments, dictation and ratings, as the bot is configured.

| Prop | Default | Meaning |
| --- | --- | --- |
| `className` | | On the element that holds the chat. Give it a height. |
| `headingLevel` | `2` | The level of the chat's title; the welcome heading is one below. Pick what fits your page's outline. |
| `colorScheme` | the bot's | `'light'`, `'dark'` or `'auto'`, for example to follow your site's dark mode switch. |
| `onClose` | | Shows a close button. Escape, pressed in the chat, calls it too. |
| `components` | | Replaces `Header`, `Welcome`, `Message` or `Footer`. |

A replacement takes no props. It reads what it needs with the hooks:

```tsx
'use client';
import { DefaultChat, useChat } from '@boldare/askdare/react';

function Header() {
  const { bot, state, actions } = useChat();
  return (
    <header>
      <h2>{bot.title}</h2>
      {state.messages.length > 0 && (
        <button type="button" onClick={() => void actions.newConversation()}>Start over</button>
      )}
    </header>
  );
}

export function HelpChat() {
  return <DefaultChat className="help-chat" components={{ Header }} />;
}
```

The chat doesn't take focus or scroll to itself when the page loads. When an answer or a transcript arrives, it returns focus to the message field only if focus was in the chat or nowhere, never from your page's own fields, and without scrolling. `actions.focus()` always moves it. Escape pressed outside the chat is left to your page.

## Your own markup

Every primitive renders one element with its usual `data-ask-part` name ([Styling](styling.md)), and passes `className`, `ref` and other native props through. Write `import * as Chat` to keep them together:

```tsx
'use client';
import * as Chat from '@boldare/askdare/react';

function Bubble() {
  const message = Chat.useMessage();
  return (
    <Chat.Message className={message.role === 'user' ? 'mine' : 'theirs'}>
      <Chat.MessageText />
      <Chat.MessageFiles />
      <Chat.Citations />
      <Chat.FeedbackButton rating="up">👍</Chat.FeedbackButton>
      <Chat.FeedbackButton rating="down">👎</Chat.FeedbackButton>
    </Chat.Message>
  );
}

export function PlainChat({ config }: { config: Chat.ChatConfig }) {
  return (
    <Chat.Root config={config}>
      <Chat.Panel className="plain-chat">
        <Chat.Messages>
          <Chat.MessageList>
            <Bubble />
          </Chat.MessageList>
          <Chat.Status />
        </Chat.Messages>
        <Chat.ErrorMessage />
        <Chat.Composer>
          <Chat.Files />
          <Chat.AttachButton>Attach</Chat.AttachButton>
          <Chat.Input />
          <Chat.DictateButton>Dictate</Chat.DictateButton>
          <Chat.Recorder />
          <Chat.Send>Send</Chat.Send>
        </Chat.Composer>
      </Chat.Panel>
    </Chat.Root>
  );
}
```

Without `Theme` and `DefaultChat`, no stylesheet of the chat loads: the look is all yours.

| Primitive | Element | What it does |
| --- | --- | --- |
| `Theme` | `div` | Sets the bot's tokens (`--ask-*`) and theme variants for everything inside, and loads the theme and its fonts. Takes `colorScheme`. |
| `Panel` | `section` | The chat's frame, a region named after the bot. Files dropped on it are attached. |
| `Messages` | `div` | The conversation, as a live region that follows the latest message. |
| `MessageList` | none | Renders its children once per message. |
| `Message` | `div` | One message, with `data-role` and `data-status`. |
| `MessageText` | `div` | The text: the visitor's as typed, an answer as Markdown, typing dots before the first word. |
| `Markdown` | none | Renders a `text` as the chat renders answers. |
| `Citations` | `ol` | The answer's sources. |
| `MessageFiles` | `ul` or `p` | The files sent with a message. |
| `FeedbackButton` | `button` | Rates the answer; takes `rating="up"` or `"down"`. See [Answer ratings](feedback.md). |
| `Composer` | `form` | Submitting it sends the draft, Enter in the `Input` included. An `onSubmit` of yours that calls `event.preventDefault()` takes the message over. |
| `Input` | `textarea` | The message field: Enter sends, Shift+Enter starts a new line, pasted files are attached. Your `onKeyDown` or `onPaste` can prevent either. |
| `Send` | `button` | Sends; disabled until there is something to send. |
| `AttachButton` | `button` | Opens the file picker. Renders nothing when the bot takes no attachments. |
| `Files` | `ul` | The files picked for the next message. |
| `DictateButton` | `button` | Starts a dictation. Renders nothing without voice input. |
| `Recorder` | `div` | The running dictation, with cancel and done. Renders nothing otherwise. |
| `Status` | `p` | What the assistant is doing before it writes, or that a conversation is loading. |
| `ErrorMessage` | `p` | The latest problem, in the visitor's language. |

Primitives that have nothing to show render nothing, so you can place them without conditions.

**Never render an answer as HTML.** Model output can be steered by whatever the model reads. `MessageText` and `Markdown` turn it into elements without ever producing HTML, allow only `http`, `https` and `mailto` links, and never load images. If you render `message.text` yourself, render it as text.

### Hooks

- **`useChat()`** returns `{ state, actions, bot, t }` and re-renders on every change.
- **`useChatState(select)`** returns one value and re-renders only when it changes: `useChatState((state) => state.busy)`. Return a value from the state, not a new object.
- **`useMessage()`** returns the message being rendered, inside `MessageList`.

| `state` | Meaning |
| --- | --- |
| `phase` | `'starting'` on the server and until the chat knows the visitor, `'loading'` while a stored conversation loads, then `'ready'`. |
| `busy` | A turn is under way. |
| `messages` | Each with `id`, `role`, `text`, `status` (`'streaming'`, `'done'`, `'error'`), `citations`, `files` and `feedback`. |
| `draft`, `files` | The message field's text and the files picked for the next message. |
| `error`, `activity` | The latest problem, and what the assistant is doing before it writes. |
| `dictation`, `elapsed`, `canDictate` | The dictation: `'idle'`, `'recording'` or `'transcribing'`, its seconds, and whether this browser can record. |
| `ratings`, `commenting` | The visitor's ratings by `message.feedback.key`, and the answer the chat asks about after a 👎. |

| `actions` | Meaning |
| --- | --- |
| `send(text?)` | Sends the draft, or `text` on its own (a suggested question). |
| `setDraft(text)` | Sets the message field. |
| `addFiles(files)`, `removeFile(key)` | Files for the next message. |
| `startDictation()`, `finishDictation()`, `cancelDictation()` | Dictation; finishing puts the transcript into the draft. |
| `newConversation()` | Deletes the conversation and starts with an empty chat. |
| `rate(messageId, rating, comment?)`, `dismissComment()` | Ratings: `'up'`, `'down'`, or `null` to take one back. |
| `focus()` | Moves keyboard focus to the message field. |

`bot` holds the bot's public settings in the visitor's language (`title`, `greeting`, `starters`, `placeholder`, `avatar`, `disclosure`, what may be attached). `t(key)` returns any of the chat's [texts](texts.md).

## Styling

The same tokens and parts as the widget ([Styling](styling.md), [Themes](themes.md)), with three differences inside a page:

- **The theme root is an element, not the document.** `Theme` (inside `DefaultChat`) renders `<div data-askdare-root data-ask-bot="support" …>` with the variant attributes. Where the widget's docs say `:root` or `<html>`, read that element.
- **Your site's CSS reaches the chat.** The chat's styles are in `@layer askdare` and never reach outside the chat. Your own unlayered CSS wins over them, on purpose: `[data-ask-part="bubble"] { border-radius: 6px; }` in your stylesheet just works. A broad rule of your site, such as `button { text-transform: uppercase; }`, applies to the chat's buttons too.
- **The bot's `widget.css` still applies, scoped to that bot's chat.** `:root` in it means the theme root.

### With a CSS reset (Tailwind)

A reset written without a layer overrides the chat's layered styles. Put the reset in a layer that comes before `askdare`:

```css
/* Tailwind CSS 4 */
@layer theme, base, askdare, components, utilities;
@import "tailwindcss";
```

```css
/* Tailwind CSS 3 */
@layer tailwind-base, askdare;
@layer tailwind-base {
  @tailwind base;
}
@tailwind components;
@tailwind utilities;
```

With that order the chat looks the same as without the reset, and your utilities still win over it.

## Content Security Policy

The widget brings its own policy inside the iframe. A chat inside your page lives under your page's policy, which must allow, all for your own origin:

| Directive | Why |
| --- | --- |
| `connect-src 'self'` | The chat's requests to the chat route. |
| `style-src 'self'` | The theme, skin and font stylesheets from the chat route. |
| `font-src 'self'` | The built-in themes' fonts. |
| `img-src 'self' blob: data:` | Previews of files the visitor attaches, and a `data:` avatar. |
| `Permissions-Policy: microphone=(self)` | Dictation, if the bot has voice input. |

## Eject the default look

When the props and slots of `DefaultChat` aren't enough, copy its source into your app and change it:

```bash
npx @boldare/askdare add ui
```

It writes the components and their stylesheet to `components/askdare` and never overwrites a file ([Command line](cli.md#add-ui)). Then change one import:

```diff
- import { DefaultChat } from '@boldare/askdare/react';
+ import { DefaultChat } from '@/components/askdare';
```

The copy imports only `@boldare/askdare/react`, so `Root`, the hooks and the primitives keep coming from the library and keep getting its fixes. The copied files are yours: when a later version changes the default look, the changelog says so, and you take what you want by hand.

## Good to know

- **Server rendering.** The chat renders on the server in its starting state, with the greeting and suggestions, and connects after hydration. A stored conversation appears then.
- **Several chats on a page** work, each in its own `Root`, also for different bots with different themes.
- **One conversation per bot and browser**, shared by every page that shows that bot, and by the widget on the same origin.
- **Sizes** (gzipped, in your bundle): about 28 KB for everything, about 8 KB when you use only `Root` and the hooks. The Markdown renderer is loaded only if you render `MessageText` or `Markdown`.
