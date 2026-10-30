# Privacy

This page lists what data the chat handles, where it goes and how long it stays, so you can write your privacy notice. It describes what askdare does; it isn't legal advice. Your instructions, your tools and your hosting can add data of their own.

## At a glance

| Data | Where | How long |
| --- | --- | --- |
| A handle to the current conversation (resume token) | The visitor's browser: `localStorage` of your app's origin, inside the chat's iframe | Until the visitor starts a new conversation; it works for at most 30 days |
| A session token | The iframe's memory, never stored | 15 minutes |
| Messages, answers, page context, tool calls and their results | OpenAI, as a conversation in your project | Until deleted |
| Model responses | OpenAI | OpenAI's retention for stored responses |
| Uploaded images and PDFs | OpenAI, as files in your project | 30 days, or until the conversation is deleted |
| Dictations | Sent to OpenAI for transcription | askdare keeps no audio |
| IP addresses, visitor IDs, conversation IDs | Rate-limit counters, in your server's memory or in Upstash | IP addresses up to 2 days, conversation IDs up to 30 days |
| An HMAC of the visitor or user ID (`safety_identifier`) | Sent to OpenAI with every model request | OpenAI's retention |
| Error reports | Your server log, or your `onError` function | Your hosting's log retention |

## In the visitor's browser

The script on your site (`widget.js`) adds the chat button and an iframe. It stores nothing on your site and sets no cookies. The chat itself runs inside the iframe, on your app's origin:

- Its Content Security Policy lets it load scripts, styles, fonts and images only from your app, and talk only to your app. Images in answers are never loaded; the chat shows their alt text.
- The iframe is loaded with `referrerpolicy="strict-origin"`, so your app learns which site embeds the chat, but not which page.

### What it stores

After the visitor's first message, the chat writes one entry to `localStorage`, in the iframe's storage for your app's origin. Nothing is written before that.

| | |
| --- | --- |
| Key | `askdare:<bot id>:resume` for an anonymous visitor; `askdare:<bot id>:resume:<key>` for a [signed-in visitor](identity.md), where `<key>` is 32 hexadecimal characters derived from the bot and user ID with `IDENTITY_SECRET`. It reveals nothing about the user |
| Value | An encrypted token with the visitor ID and a reference to the conversation. The browser can't read it |
| Purpose | To show and continue the conversation after a reload |
| Lifetime | It works for 30 days after the last answer in the conversation: each answer renews it. It is removed when the visitor starts a new conversation, and when the server says the conversation is gone or the token expired |

Everything else stays in memory and disappears with the page: the session token, which lasts 15 minutes, and a signed-in visitor's identity.

The chat sets no cookies. Browsers may partition or block storage in iframes from other sites; then the conversation doesn't survive a reload, and the chat still works. There is no setting to turn the entry off.

### Consent banners

Whether this entry needs the visitor's consent under the rules that apply to you, such as the ePrivacy Directive in the EU, is for you and your legal advisers to decide. These facts are often relevant:

- It is written only after the visitor sends a message, and only to continue that conversation.
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
- Your hosting provider may log every request, IP addresses included, according to its own settings.

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
- Your tools' definitions and, when the model calls them, their results.
- The `safety_identifier`, and `prompt_cache_key: "askdare:<bot id>"`, which holds no personal data.

### Conversations

- Conversations are stored with OpenAI's Conversations API, in your project, **until they are deleted** ([ADR-0003](adr/0003-conversation-state.md)). Each one carries the bot ID and the visitor ID as metadata (`askdare_bot`, `askdare_visitor`).
- A conversation holds the visitor's messages, the page context, the answers, and the tool calls with their results. The instructions are sent with each request rather than stored in the conversation.
- **The visitor can delete it.** "Start a new conversation" asks "Start a new conversation? The current one will be deleted." and then deletes it at OpenAI. For bots with attachments, the files attached in it are deleted too; a file that fails to delete expires on its own.
- **Nothing else deletes it.** When the browser's handle expires after 30 days, or the visitor clears the browser, the conversation stays in your project. askdare keeps no list of conversations, and OpenAI's API has no endpoint to list them, so there is no tool to find, export or delete one visitor's conversation. Take this into account in your retention decision ([Going public](going-public.md#6-privacy-and-transparency)).
- **Who can read it:** whoever uses the same browser can continue an anonymous conversation and see its history while the handle works. On a shared computer, that includes the next person, unless the visitor started a new conversation. A conversation started while signed in is shown only to that user ([Signed-in visitors](identity.md)).

### Responses

askdare stores each model response (`store: true`), because a conversation needs it. A stored response includes the instructions it was given. OpenAI's [data controls](https://developers.openai.com/api/docs/guides/your-data) list 30 days by default for this stored state of the Responses API, and up to 30 days for abuse monitoring logs. Check that page for the current terms.

### Uploaded files

- Files are uploaded with purpose `user_data` and `expires_after` set to 30 days from the upload. OpenAI deletes them then, or askdare deletes them earlier with their conversation.
- Files that are uploaded but never sent stay until they expire.
- The widget re-encodes images in the browser, which drops EXIF data such as the GPS position. PDFs are uploaded as they are.
- The file name goes to OpenAI too, cleaned of unusual characters.
- Files are never served back to browsers. See [Attachments](attachments.md).

### Dictations

The recording goes to OpenAI's transcription API and nowhere else, and askdare stores no audio. The transcript lands in the message field; it reaches the conversation only if the visitor sends it. See [Voice input](voice-input.md).

### Zero Data Retention

askdare doesn't use Zero Data Retention. OpenAI grants it only after approval, and its data controls page lists the Conversations API as not eligible. Clients who need zero retention or data residency need the planned own-storage add-on.

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
| Upstash | With `@boldare/askdare-upstash` | Rate-limit counters, whose names hold IP addresses, visitor IDs and conversation IDs |
| Your hosting provider, such as Vercel or Heroku | Always | Every request to the app, with IP addresses, and the server log |
| Your error monitoring | With `onError` | Error reports, without message contents or API keys |

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

- [ ] Name OpenAI, and Upstash if you use it, as processors, and your hosting provider.
- [ ] Say that conversations, including what visitors type and attach, are stored by OpenAI until deleted, and how visitors delete them.
- [ ] Describe the `localStorage` entry and its purpose.
- [ ] Mention IP addresses in rate limits and their retention.
- [ ] Decide on a retention policy for conversations.
- [ ] Keep the AI disclosure, and link this notice from it with `privacyUrl`.
