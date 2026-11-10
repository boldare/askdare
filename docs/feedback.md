# Answer ratings

Visitors can rate each answer with 👍 or 👎 and, after a 👎, say what went wrong. askdare stores no ratings: every one goes to your `onFeedback` function, and you decide where to keep it ([ADR-0012](adr/0012-server-hooks-and-telemetry.md)).

## Turn ratings on

Pass `onFeedback` to `createChatHandler`. Without it the buttons don't show, because there would be nowhere to send a rating.

```ts
// app/api/chat/[...path]/route.ts
export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onFeedback: async ({ bot, rating, comment, conversationId, itemId, visitor }) => {
    await db.insert(ratings).values({ bot, rating, comment, conversationId, itemId, visitor });
  },
});
```

The function may be async. It runs after the response, and nothing it throws reaches the chat. The fields of the report are listed under [`onFeedback` in Configuration](configuration.md#onfeedback).

To hide the buttons for one bot, set `widget: { feedback: false }` in its `defineBot`.

## What visitors see

- **👍 and 👎** under every finished answer. The pressed button shows the visitor's rating, and a second click on it takes the rating back.
- **"What went wrong?"** after a 👎: a short field with **Send feedback** and **Skip**. The comment is optional and holds up to 500 characters. Escape skips it too.
- **Their rating again after a reload.** The browser remembers the latest hundred ratings in its own storage, in the same best-effort way as the conversation.

The widget and the chat inside a page ([React](react.md)) behave the same.

## What your function receives

| Visitor's action | `rating` | `comment` |
| --- | --- | --- |
| 👍 | `'up'` | absent |
| 👎 | `'down'` | absent |
| 👎, then a comment | `'down'` again, for the same answer | the text |
| Takes the rating back | `null` | absent |

A 👎 arrives at once, and the comment follows as a second report for the same `itemId`, so a visitor who never writes one still counts. Keep the latest report per `conversationId` and `itemId`: a later one replaces the earlier.

`conversationId` and `itemId` are the raw OpenAI IDs, so your own code can fetch the conversation for review. They never reach the browser.

## Limits and safety

- A visitor can rate only answers of their own conversations. Each answer carries an encrypted handle bound to the bot and to the visitor, or to the signed-in user.
- Ratings are limited to 20 a minute per visitor.
- A comment is text a visitor typed. Treat it like a message: cover it in your privacy notice, and escape it wherever you show it. See [Privacy](privacy.md).

## Texts and styling

- **Texts:** `feedback.label`, `feedback.up`, `feedback.down`, `feedback.comment`, `feedback.send` and `feedback.skip`, in English and Polish. Override them with `widget.texts` like any other ([Texts](texts.md)).
- **Parts:** `feedback` (the two buttons), `feedback-button` (with `data-rating="up"` or `"down"`, and `aria-pressed`), `feedback-comment`, `feedback-comment-input`, `feedback-comment-actions`, `feedback-skip` and `feedback-send` ([Styling](styling.md)).
- **In your own markup:** `FeedbackButton` from `@boldare/askdare/react`, and `actions.rate(messageId, rating, comment?)` with `state.commenting` for the question after a 👎.
