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

## Examples

Each report holds the rating, the visitor's comment if they wrote one, the bot, a pseudonym of the visitor, the signed-in user if there is one, and the OpenAI IDs of the conversation and the answer. It never holds the question or the answer: to read those, fetch the conversation with your OpenAI key.

Two parts need care wherever you send them:
- **`comment` and `identity` are personal data.** Keep them where you keep other visitor data, and never write the report to your logs as a whole.
- **`conversationId` and `itemId` lead to the whole conversation** for anyone with your OpenAI key. Keep them out of logs and analytics too.

### Post each 👎 with a comment to Slack

```ts
// app/api/chat/[...path]/route.ts
// Slack reads <, > and & as markup: escaped, a comment can't add links or @channel.
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onFeedback: async ({ bot, rating, comment, conversationId, itemId }) => {
    const webhook = process.env.SLACK_FEEDBACK_WEBHOOK;
    if (!webhook || rating !== 'down' || comment === undefined) return;
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `👎 on *${bot}*\n>${escape(comment)}\nConversation \`${conversationId}\`, answer \`${itemId}\``,
      }),
    });
    if (!response.ok) throw new Error(`Slack answered ${response.status}`);
  },
});
```

- **Only reports with a comment.** A 👎 arrives first without one, and its comment follows as a second report. Posting every 👎 would post most of them twice, or with nothing to read. Count the bare ones [below](#count-ratings-next-to-onusage).
- **Slack now holds visitors' comments.** Name it in your privacy notice, and post to a channel that only the people who review answers can read.
- **The webhook URL is a secret.** Keep it in an environment variable, never in `widget`.
- **A failed post doesn't reach the chat.** askdare logs the error's name, not its message, so the comment stays out of your logs.

### Store ratings in your database

Keep one row per answer and let a later report replace the earlier one: the comment that follows a 👎, a changed mind, a rating taken back. In Postgres:

```sql
create table chat_ratings (
  conversation_id text not null,
  item_id text not null,
  bot text not null,
  visitor text not null,
  rating text,            -- 'up', 'down', or null when taken back
  comment text,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, item_id)
);
```

```ts
// app/api/chat/[...path]/route.ts
import { sql } from '@/lib/db'; // your Postgres client, such as `postgres` or `@vercel/postgres`

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onFeedback: async ({ bot, rating, comment, visitor, conversationId, itemId }) => {
    await sql`
      insert into chat_ratings (conversation_id, item_id, bot, visitor, rating, comment)
      values (${conversationId}, ${itemId}, ${bot}, ${visitor}, ${rating}, ${comment ?? null})
      on conflict (conversation_id, item_id) do update
        set rating = excluded.rating, comment = excluded.comment, updated_at = now()`;
  },
});
```

- **Query parameters, not string concatenation.** A comment is untrusted text.
- **Keep comments no longer than you need.** Clear them on a schedule, for example `update chat_ratings set comment = null where updated_at < now() - interval '90 days'`.
- **Review the 👎 answers** in an internal tool of yours: read the conversation with `openai.conversations.items.list(conversationId)` and find the answer by `itemId`. Never show that tool to visitors.
- **Sum them up** with `select bot, rating, count(*) from chat_ratings group by bot, rating`.

### Count ratings next to `onUsage`

To watch the share of 👍 and 👎 on a dashboard, count ratings where you already count turns ([Observability](observability.md)):

```ts
export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onUsage: async ({ bot, outcome }) => {
    await metrics.increment('chat.turns', { bot, outcome });
  },
  onFeedback: async ({ bot, rating, comment }) => {
    if (comment !== undefined) return; // the comment of a 👎 that was already counted
    await metrics.increment('chat.ratings', { bot, rating: rating ?? 'withdrawn' });
  },
});
```

`chat.ratings` divided by completed `chat.turns` is how often visitors rate; `down` divided by all ratings is how often they're unhappy. The counts are close, not exact: a visitor who changes their mind counts twice, and a rating taken back counts as `withdrawn`. For exact numbers, use the table above.

`visitor` is the same pseudonym in both reports, so you can also line ratings up with the cost of the same visitor's turns, without knowing who they are.

With `otelUsage()` from `@boldare/askdare-otel`, use an OpenTelemetry counter beside it:

```ts
import { otelUsage } from '@boldare/askdare-otel';
import { metrics } from '@opentelemetry/api';

const ratings = metrics.getMeter('my-site').createCounter('chat.ratings');

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onUsage: otelUsage(),
  onFeedback: ({ bot, rating, comment }) => {
    if (comment === undefined) ratings.add(1, { bot, rating: rating ?? 'withdrawn' });
  },
});
```

To do several of these, call them one after another in a single `onFeedback`.

## Texts and styling

- **Texts:** `feedback.label`, `feedback.up`, `feedback.down`, `feedback.comment`, `feedback.send` and `feedback.skip`, in English and Polish. Override them with `widget.texts` like any other ([Texts](texts.md)).
- **Parts:** `feedback` (the two buttons), `feedback-button` (with `data-rating="up"` or `"down"`, and `aria-pressed`), `feedback-comment`, `feedback-comment-input`, `feedback-comment-actions`, `feedback-skip` and `feedback-send` ([Styling](styling.md)).
- **In your own markup:** `FeedbackButton` from `@boldare/askdare/react`, and `actions.rate(messageId, rating, comment?)` with `state.commenting` for the question after a 👎.
