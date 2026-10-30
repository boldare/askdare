---
"@boldare/askdare": minor
"@boldare/askdare-upstash": patch
---

Setup mistakes now say what is wrong:

- **A chat that never loads:** a site missing from `security.allowedOrigins`, or a wrong bot ID, no longer leaves a blank panel. After 8 s the panel says the chat couldn't load, and the console names the bot, the page's origin and the doctor command to check it. New text key `launcher.unavailable`.
- **Setup errors:** a missing `OPENAI_API_KEY` or `CHAT_SECRET`, a weak secret, a key OpenAI rejects, or a model the project can't use is logged in plain words, with a pointer to the troubleshooting guide. During development the chat shows the same explanation instead of "Something went wrong". API keys in OpenAI's error messages are cut down to their prefix.
- **A missing model:** the error names `ASKDARE_MODEL`, and `doctor` reports the variable when it is missing as well as when it is empty.
- **New option `onError`** in `createChatHandler`: sends every server error to your monitoring, with its code and explanation (type `ChatErrorReport`).
- **`doctor`:**
  - `--origin <url>` checks that a site may embed the chat;
  - it warns when a bot may answer for longer than the route's `maxDuration`.
- **`askdare --version`:** prints the installed version.
- **`init`:** loads the chat with `next/script` (`strategy="afterInteractive"`), the way the docs do.
- **Types:** `VoiceConfig` is exported.
- **Upstash add-on:** also reads `KV_REST_API_URL` and `KV_REST_API_TOKEN`, the names from Vercel KV databases.
