# Voice input

Visitors can dictate a message instead of typing it. The recording is transcribed by OpenAI and the text lands in the message field, where the visitor can check and edit it before sending. Nothing is sent to the model until they press Send.

## Turn it on

```ts
defineBot({
  // …
  voice: { model: process.env.ASKDARE_TRANSCRIBE_MODEL ?? '' }, // dictations up to 60 seconds
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | required | OpenAI transcription model. The library never assumes one; `gpt-transcribe` is current (the older transcription models shut down on 2027-02-26) |
| `maxSeconds` | `60` | Longest dictation (5–300). Recording stops by itself at this point |

Limits (in `limits`): `transcriptionsPerVisitorPerHour` (default 30), and speech budgets in seconds, because transcription is billed by duration: `voiceSecondsPerDay` per bot (default 3,600) and `voiceSecondsPerIpPerDay` (default 600). Each dictation reserves `maxSeconds` and is then charged the duration OpenAI reports. If OpenAI reports no duration (token-billed models) or the call times out, it is charged the longest audio the file could hold, so prefer `gpt-transcribe`. A dictation that OpenAI refuses with an error is not charged. At most 2 dictations per IP and 10 per bot are transcribed at once.

## How it works

- The widget shows a microphone button when the browser can record and the page lets the iframe use the microphone. The browser asks the visitor for permission the first time.
- While recording, the widget shows "Listening…", a level meter and a timer. **Done** stops and transcribes; **×** or Escape cancels. Closing the chat or switching tabs cancels too, and recording stops by itself at `maxSeconds`.
- Chrome, Firefox and Edge record WebM/Opus, Safari records MP4. The server checks the format from the file's bytes before sending it to OpenAI.
- The visitor's browser languages and the widget locale are sent as hints, which helps with short phrases.
- askdare keeps no audio. The recording goes to OpenAI's transcription API and nowhere else.

## Embedding

The loader's iframe delegates the microphone (`allow="microphone"`), and the embed page enables it only for bots with `voice`. If the website itself forbids the microphone (`Permissions-Policy: microphone=()`), the button is hidden, or in Safari the visitor sees "Microphone access is blocked".
