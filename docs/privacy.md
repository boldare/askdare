# Privacy

This page lists what data the chat handles, where it goes and how long it stays, so you can write your privacy notice. It describes what askdare does; it isn't legal advice. Your instructions, your tools and your hosting can add data of their own.

## At a glance

| Data | Where | How long |
| --- | --- | --- |
| A handle to the current conversation (resume token) | The visitor's browser: `localStorage` of your app's origin, inside the chat's iframe or, for a [chat inside your page](react.md), in the page itself | Until the visitor starts a new conversation; it works for at most 30 days |
| Which answers the visitor rated 👍 or 👎 | The same `localStorage`, when ratings are on | The latest hundred ratings; never sent anywhere |
| A session token | The chat's memory (the iframe's, or the page's for a chat inside your page), never stored | 15 minutes |
| Messages, answers, page context, tool calls and their results | OpenAI, as a conversation in your project; or your own [conversation store](#with-your-own-conversation-store) | Until deleted |
| Model responses | OpenAI, unless you use your own conversation store | OpenAI's retention for stored responses |
| Uploaded images and PDFs | OpenAI, as files in your project | 30 days, or until the conversation is deleted |
| Dictations | Sent to OpenAI for transcription | askdare keeps no audio |
| Messages and answers to check, with [`moderation`](guardrails.md#moderation) | Sent to OpenAI's moderation endpoint | OpenAI's retention; askdare keeps no scores |
| A human-check token and what Cloudflare's widget collects, with [`security.humanVerifier`](configuration.md#human-check) | Cloudflare | Cloudflare's retention |
| IP addresses, visitor IDs, conversation IDs | Rate-limit counters, in your server's memory or in Upstash | IP addresses up to 2 days, conversation IDs up to 30 days |
| An HMAC of the visitor or user ID (`safety_identifier`) | Sent to OpenAI with every model request | OpenAI's retention |
| Error reports | Your server log, or your `onError` function | Your hosting's log retention |
| Turn reports: token counts, timings, tool names, pseudonyms | Your `onUsage` function, if you set one | Wherever you keep them |
| Ratings of answers and the comments visitors write | Your `onFeedback` function, if you set one | Wherever you keep them |
| Transcripts: each message (after `onInput`) and the answer the visitor saw | Your [`onTranscript`](#transcripts) function, if you set one | Wherever you keep them |
| Chat events: counts, durations, outcomes, ratings (no text) | Your page's `askdare('on')` or `onEvent` listeners ([Chat events](events.md)), if you add any | Wherever your analytics keeps them |

## In the visitor's browser

The script on your site (`widget.js`) adds the chat button and an iframe. It stores nothing on your site and sets no cookies. The chat itself runs inside the iframe, on your app's origin:

- Its Content Security Policy lets it load scripts, styles, fonts and images only from your app, and talk only to your app. Images in answers are never loaded; the chat shows their alt text.
- The iframe is loaded with `referrerpolicy="strict-origin"`, so your app learns which site embeds the chat, but not which page.

### What it stores

After the visitor's first message, the chat writes an entry to `localStorage` for your app's origin: in the iframe's storage for the widget, in your page's own storage for a [chat inside your page](react.md). Nothing is written before that. A second entry follows if the visitor rates an answer.

**The conversation**

| | |
| --- | --- |
| Key | `askdare:<bot id>:resume` for an anonymous visitor; `askdare:<bot id>:resume:<key>` for a [signed-in visitor](identity.md), where `<key>` is 32 hexadecimal characters derived from the bot and user ID with `IDENTITY_SECRET`. It reveals nothing about the user |
| Value | An encrypted token with the visitor ID and a reference to the conversation. The browser can't read it |
| Purpose | To show and continue the conversation after a reload |
| Lifetime | It works for 30 days after the last answer in the conversation: each answer renews it. It is removed when the visitor starts a new conversation, and when the server says the conversation is gone or the token expired |

**Ratings**, only when your route has `onFeedback` and the bot hasn't turned them off with `widget.feedback: false`:

| | |
| --- | --- |
| Key | `askdare:<bot id>:ratings` |
| Value | Which answers this browser rated 👍 or 👎, by a pseudonym of each answer (an HMAC, not the OpenAI ID). No comments, no text, nothing about the visitor |
| Purpose | To show the visitor's ratings again after a reload |
| Lifetime | The latest hundred ratings are kept; taking a rating back removes it. It isn't sent to the server: the server keeps no ratings at all |

Everything else stays in memory and disappears with the page: the session token, which lasts 15 minutes, and a signed-in visitor's identity. The chat's language, set with `askdare('configure', { locale })` or `data-follow-lang`, isn't stored either: the page sets it again on every load ([Texts](texts.md)).

The chat sets no cookies. Browsers may partition or block storage in iframes from other sites; then the conversation doesn't survive a reload, and the chat still works. There is no setting to turn the conversation entry off; ratings go with `onFeedback`.

**A chat inside your page** has no iframe of its own: its entries sit in your page's `localStorage` beside your own, and scripts on the page can read them, the session token and the conversation. The widget's iframe keeps those from the page. See [the React guide](react.md) for when to keep the widget.

### Consent banners

Whether these entries need the visitor's consent under the rules that apply to you, such as the ePrivacy Directive in the EU, is for you and your legal advisers to decide. These facts are often relevant:

- The conversation entry is written only after the visitor sends a message, and only to continue that conversation. The ratings entry is written only when the visitor rates an answer, and only to show that rating again.
- It isn't used for tracking, analytics or advertising, and it isn't shared with other sites.
- It contains no readable personal data, and it stops working after 30 days at most.

## On your server

askdare needs no database. Your app keeps only rate-limit counters.

### IP addresses

- The client IP is used for rate limits and budgets only, never to identify anyone.
- It isn't hashed. IPv4 addresses are kept whole; IPv6 addresses are cut to their /64 network. They are part of counter names, such as `ask:ti:<bot id>:<ip>:<date>`.
- The counters live in the server's memory by default, in your Upstash database with `@boldare/askdare-upstash`, or in your own [store](custom-store.md).
- Each counter lasts as long as its window: from a minute up to 2 days for the daily budgets. Upstash deletes a counter when its window ends. The memory store drops expired counters within a minute, and everything when the process restarts.

### Visitor IDs

The server gives every new visitor a random ID: `v_` followed by 32 hexadecimal characters. It never comes from the browser, and it identifies a chat in one browser, not a person. It travels inside the encrypted tokens, names some rate-limit counters, and is stored with the conversation at OpenAI.

### Logs

- askdare never logs message contents, and cuts API keys down to their prefix.
- It logs one line per server error: the error code, an explanation of setup problems, and the underlying error, such as OpenAI's status, error code and request ID. It also logs the ID of an uploaded file it couldn't delete.
- Errors thrown by your own tools are logged as they are. Keep personal data out of their messages.
- With `onError` in `createChatHandler`, the same reports go to your function, for example to Sentry, instead of the log.
- With `onUsage`, every turn's report goes to your function: token counts, timings, tool names and outcomes, and pseudonyms (HMACs) of the conversation and the visitor or user. It holds no message text. See [Observability](observability.md).
- With `onFeedback`, visitors can rate answers, and each rating goes to your function with the comment the visitor wrote, the OpenAI conversation and answer IDs, a pseudonym of the visitor, and the signed-in user if there is one. askdare keeps none of it. A comment is free text the visitor typed, so treat it like a message: mention it in your notice and keep it no longer than you need. The visitor's browser also remembers which answers they rated 👍 or 👎 (not the comments), next to the conversation in its storage (see [What it stores](#what-it-stores)). See [Answer ratings](feedback.md).
- With `onTranscript`, every finished turn goes to your function with what the visitor sent and the answer they saw. See [Transcripts](#transcripts).
- Your hosting provider may log every request, IP addresses included, according to its own settings.

### Transcripts

`onTranscript` in `createChatHandler` is off unless you set it. It is the only hook that receives message content ([ADR-0016](adr/0016-admin.md)), so with it, conversations reach a place you run, next to the conversation store.

- **What it receives:** after each turn whose answer finished, the visitor's message after your `onInput` hook (a redacted message arrives redacted), the number of attached files (not their names or contents), and the answer the visitor saw after output checks (the replacement of a replaced answer, nothing of a withheld one), with its sources. With it come the bot ID, a pseudonym of the visitor or user, the signed-in user if there is one, and the raw conversation and answer IDs. Never the instructions, page context, tool calls or their results.
- **When:** after the answer has streamed, so it never delays the chat. Not for messages your checks blocked, or turns that failed before their answer finished.
- **When it throws:** the chat carries on, and `onError` receives `internal_error` with the name of the error's class only. askdare never logs the transcript or the hook's error message, since a failed database write can quote the values it was given. That turn's transcript is lost.
- **askdare keeps none of it.** Where you store transcripts, for how long and who reads them is your decision, and your privacy notice must cover it. A visitor who starts a new conversation deletes it from the conversation store, but askdare calls no hook then, so a stored transcript stays until you delete it: set a retention period, and keep transcripts by conversation and visitor so you can find, export or delete one person's on request.

### `safety_identifier`

Every model request carries a `safety_identifier`, so OpenAI can trace abuse to one end user instead of to your whole project.

- For an anonymous visitor, it is an HMAC of the random visitor ID.
- For a signed-in visitor, it is an HMAC of `user:` followed by your user ID, so it is the same on every device.

The HMAC key is derived from `CHAT_SECRET`, so knowing a user ID isn't enough to compute it. It is still a pseudonym, not anonymous data: with the secret, the link to a user can be restored. It changes when `CHAT_SECRET` rotates.

## At OpenAI

Everything below lives in the OpenAI project whose key the app uses. Name OpenAI in your privacy notice.

### What each message sends

- Your instructions for that request, with whatever you put in them, such as a signed-in user's name.
- The visitor's message, and the page context from `askdare('configure')` if the bot has `pageContext: true`.
- Attached files, by reference.
- Your tools' definitions and, when the model calls them, their results. With `widget.replies: 'suggest'`, also the definition of the built-in `suggest_replies` tool, which holds no personal data.
- The `safety_identifier`, and `prompt_cache_key: "askdare:<bot id>"`, which holds no personal data.

### Moderation

Only for a bot with [`moderation`](guardrails.md#moderation): askdare sends the text it checks to OpenAI's moderation endpoint (`POST /v1/moderations`), with the same API key, as a separate request.

- With `check: 'input'` (the default), that is each visitor message, after your `onInput` hook, and the page context for bots with `pageContext: true`. With `'output'`, each complete answer; with `'both'`, both.
- Attached files aren't sent to moderation.
- askdare keeps no scores. When moderation blocks a message, the report to `onError` names the categories, never the text.
- For bots that check answers, askdare also adds a short fixed note without content to the conversation after each check (`[askdare:allowed]`, `[askdare:withheld]` or `[askdare:replaced]`), and a replacement text from `onOutput` as an answer. A withheld answer stays in the conversation until it is deleted. See [Guardrails](guardrails.md#what-is-stored-and-logged).

### Conversations

- Conversations are stored with OpenAI's Conversations API, in your project, **until they are deleted** ([ADR-0003](adr/0003-conversation-state.md)). Each one carries the bot ID and the visitor ID as metadata (`askdare_bot`, `askdare_visitor`).
- A conversation holds the visitor's messages, the page context, the answers, and the tool calls with their results. [Reply options](reply-options.md) the model suggested are stored there as a call of `suggest_replies`; options a tool defines aren't stored on their own, since they are derived again from the stored result. A clicked option is an ordinary visitor message. [Tool cards](react.md#tool-cards) work the same way: what a tool's `ui` picks from its result is sent to the visitor's browser and shown, and is derived again from the stored result after a reload, so pick only what the visitor may see. The instructions are sent with each request rather than stored in the conversation.
- **The visitor can delete it.** "Start a new conversation" asks "Start a new conversation? The current one will be deleted." and then deletes it at OpenAI. For bots with attachments, the files attached in it are deleted too; a file that fails to delete expires on its own.
- **Nothing else deletes it.** When the browser's handle expires after 30 days, or the visitor clears the browser, the conversation stays in your project. askdare keeps no list of conversations, and OpenAI's API has no endpoint to list them, so there is no tool to find, export or delete one visitor's conversation. Take this into account in your retention decision ([Going public](going-public.md#6-privacy-and-transparency)).
- **Who can read it:** whoever uses the same browser can continue an anonymous conversation and see its history while the handle works. On a shared computer, that includes the next person, unless the visitor started a new conversation. A conversation started while signed in is shown only to that user ([Signed-in visitors](identity.md)).

### With your own conversation store

A [conversation store](custom-store.md#conversation-store) that keeps the items itself, such as `@boldare/askdare-postgres` or `memoryConversations()`, changes what stays at OpenAI ([ADR-0024](adr/0024-conversation-store.md)):

- **Conversations live in your store,** with the bot ID and the owner (the visitor ID, or a key of the signed-in user). Every message, answer, tool call and result goes there, and so does the model's encrypted reasoning, which only OpenAI can read. You decide how long they stay, and the store can delete idle ones.
- **Nothing of the conversation stays at OpenAI.** Each request sends the whole conversation with `store: false`, and OpenAI keeps no conversation and no response. What OpenAI keeps is its abuse monitoring logs of the requests, up to 30 days, as for any API request; see its [data controls](https://developers.openai.com/api/docs/guides/your-data).
- **Files still go to OpenAI**: attached images and PDFs are uploaded and referenced as above, and deleted with the conversation. The knowledge base stays in your OpenAI vector store.
- Answers are rated by their ID in your store; the rating handle carries it encrypted, as before.
- **Compaction** (`limits.compactAt`, [ADR-0029](adr/0029-compaction-for-item-stores.md)) sends the conversation to OpenAI once more after a turn, also with `store: false`, and stores the summary it returns in your store, with the conversation. The summary is encrypted, only OpenAI can read it, and it is deleted with the conversation like everything else. It may still carry what the conversation held, including an answer your output checks withheld. Nothing stored before it is changed or removed.

### Responses

With the default store, askdare stores each model response (`store: true`), because a conversation needs it. A stored response includes the instructions it was given. OpenAI's [data controls](https://developers.openai.com/api/docs/guides/your-data) list 30 days by default for this stored state of the Responses API, and up to 30 days for abuse monitoring logs. Check that page for the current terms.

### Uploaded files

- Files are uploaded with purpose `user_data` and `expires_after` set to 30 days from the upload. OpenAI deletes them then, or askdare deletes them earlier with their conversation.
- Files that are uploaded but never sent stay until they expire.
- The widget re-encodes images in the browser, which drops EXIF data such as the GPS position. PDFs are uploaded as they are.
- The file name goes to OpenAI too, cleaned of unusual characters.
- Files are never served back to browsers. See [Attachments](attachments.md).

### Dictations

The recording goes to OpenAI's transcription API and nowhere else, and askdare stores no audio. The transcript lands in the message field; it reaches the conversation only if the visitor sends it. See [Voice input](voice-input.md).

### Zero Data Retention

OpenAI grants Zero Data Retention only after approval, and its data controls page lists the Conversations API as not eligible, so the default store doesn't work for a ZDR organisation. With your [own conversation store](#with-your-own-conversation-store), turns run statelessly (`store: false`), which ZDR organisations can use, and the conversations stay in a database you choose, in the region you choose. Attached files are still uploaded to OpenAI.

## At Cloudflare

Only for a bot with a [human check](configuration.md#human-check) (`security.humanVerifier: turnstile(…)`). Otherwise nothing goes to Cloudflare.

- When the chat needs a new session, it loads Cloudflare Turnstile's script from `challenges.cloudflare.com` into the chat's document: the iframe on your app's origin, or your page for a chat inside it. The widget runs in the visitor's browser and sends Cloudflare what it needs to tell a person from a bot, such as the visitor's IP address and signals from the browser. What it collects and how long Cloudflare keeps it is set by [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- The script runs with the chat's access, so it could read what is on screen and the resume token ([Configuration](configuration.md#human-check)).
- Your server sends the token the widget returned to Cloudflare's siteverify endpoint, with your secret key. askdare sends nothing else: no message, no visitor ID.
- The session token then carries the time the visitor passed the check, for 24 hours of renewals. askdare stores nothing else about it.

Name Cloudflare as a processor in your privacy notice when the human check is on, and check whether your consent rules cover its widget.

## AI disclosure

By default, the chat shows under the message field: "You’re chatting with an AI assistant. It can make mistakes." (`disclosure.text`).

```ts
defineBot({
  // …
  widget: {
    disclosure: { privacyUrl: 'https://www.example.com/privacy' }, // or a path such as '/privacy'
  },
});
```

- `privacyUrl` adds a "Privacy policy" link (`disclosure.privacy`). It must be an https URL or a path on your app.
- You can change both texts with `widget.texts` ([Styling](styling.md#1-configuration)).
- `disclosure: false` hides the note. Do that only when your page already tells visitors they are talking to an AI.

The note exists for the transparency duty in Article 50 of the EU AI Act: people should know when they interact with an AI system, unless that is obvious from the context. Who carries the duty, and whether the default note is enough for your site, depends on your role and setup. Check with your legal advisers.

## Subprocessors

| Who | When | What they receive |
| --- | --- | --- |
| OpenAI | Always | Everything under [At OpenAI](#at-openai) |
| Cloudflare | With `security.humanVerifier: turnstile(…)` | The visitor's browser runs the Turnstile widget; your server sends its token. See [At Cloudflare](#at-cloudflare) |
| Upstash | With `@boldare/askdare-upstash` | Rate-limit counters, whose names hold IP addresses, visitor IDs and conversation IDs |
| Your hosting provider, such as Vercel or Heroku | Always | Every request to the app, with IP addresses, and the server log |
| Your error monitoring | With `onError` | Error reports, without message contents or API keys |
| Your metrics or tracing | With `onUsage`, e.g. through `@boldare/askdare-otel` | Turn reports: counters, timings and pseudonyms, without message text |

Your tools may send data to further services of your own.

## Rotating secrets

### `CHAT_SECRET`

`CHAT_SECRET` encrypts the session tokens, the resume tokens in browsers and the handles of uploaded files.

- **With `CHAT_SECRET_PREVIOUS`:** put the old secret there and set a new `CHAT_SECRET`. Existing tokens keep working, and new ones use the new secret. Remove the old one after 30 days, when the last resume tokens expire ([Going public](going-public.md#2-secrets-and-environment)).
- **Without it:** every visitor loses access to their current conversation. The chat forgets it and starts a new one at the next message, and files uploaded but not yet sent must be attached again. The old conversations stay in your OpenAI project, and nobody can reach them through the chat any more.

### `IDENTITY_SECRET`

There is no previous-secret setting for `IDENTITY_SECRET`. When you change it:

- Identity tokens signed with the old secret are refused, and those visitors continue anonymously. Change the secret in your site's backend and in the askdare app at the same time.
- Signed-in visitors with an open chat become anonymous at the next session renewal, within about 15 minutes.
- Conversations started while signed in are bound to the old secret. Their users can't resume, read or delete them in the chat any more, and they stay in your OpenAI project.

## For your privacy notice

- [ ] Name OpenAI, and Upstash and Cloudflare if you use them, as processors, and your hosting provider.
- [ ] If you turn on `moderation`, say that messages or answers are also checked by OpenAI's moderation.
- [ ] Say that conversations, including what visitors type and attach, are stored by OpenAI until deleted, and how visitors delete them.
- [ ] Describe the `localStorage` entries and their purpose: the conversation, and the ratings if you use `onFeedback`.
- [ ] If you collect ratings, say that visitors' comments reach you and how long you keep them.
- [ ] If you use `onTranscript`, say that you keep copies of conversations, where, for how long, and how visitors ask for theirs to be deleted.
- [ ] Mention IP addresses in rate limits and their retention.
- [ ] Decide on a retention policy for conversations.
- [ ] Keep the AI disclosure, and link this notice from it with `privacyUrl`.
