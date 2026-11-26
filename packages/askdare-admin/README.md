# @boldare/askdare-admin

The admin dashboard for [`@boldare/askdare`](https://www.npmjs.com/package/@boldare/askdare): cost, ratings, unanswered questions, leads, handoffs and conversation reviews, inside askdare's admin console.

**[askdare website and docs](https://askdare.vercel.app)** · [GitHub](https://github.com/boldare/askdare/tree/main/packages/askdare-admin)

## Install

```bash
npm install @boldare/askdare-admin
```

## Use

The dashboard plugs into the admin console that `createChatHandler` serves. It has no route, sign-in or storage of its own: askdare writes the records to your admin store, checks who signs in and serves the dashboard.

```ts
import { adminDashboard } from '@boldare/askdare-admin';
import { postgresAdminStore } from '@boldare/askdare-postgres';

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  conversations,
  admin: {
    store: postgresAdminStore({ pool: db }),
    transcripts: true,
    console: {
      allow: ['user_123'],
      dashboard: adminDashboard({
        // Your prices per million tokens, in your currency.
        prices: { 'your-model-id': { input: 1.25, cachedInput: 0.125, output: 10 } },
      }),
    },
  },
});
```

After signing into the console, the dashboard shows, for the last 7, 30 or 90 days and per bot:

- cost per bot, day and model, from your `prices`; a model without a price shows its tokens and "no price";
- new conversations, turns, 👍 and 👎 per day;
- unanswered questions: a heuristic that counts answers without sources from bots with knowledge, and withheld or failed ones;
- leads and handoffs per day, and the resolution rate: the share of new conversations without a handoff, per day;
- the most expensive conversations, and the 👎 answers with the visitors' comments;
- a review of a conversation from its stored transcript (with `admin.transcripts: true`), or from the conversation store through the console.

askdare keeps tokens, not money, and holds no price table: set the prices you pay. Playground turns from the console are left out.

## Privacy

The browser never gets a conversation's ID, only references sealed to the admin session. Transcripts and comments are the visitors' words: they are shown as text, never as HTML, and kept only as long as the admin store's retention.
