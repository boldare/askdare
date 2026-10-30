---
"@boldare/askdare": minor
---

Add voice input. With `voice: { model: 'gpt-transcribe' }` in `defineBot`, the widget gets a microphone button: the visitor dictates (up to `maxSeconds`, default 60), sees a level meter and timer, and the transcript lands in the message field to check before sending. Recordings (WebM/Opus or MP4) are checked by their bytes, transcribed by OpenAI with the visitor's languages as hints, and never stored. Transcription is billed by duration, so new limits budget speech in seconds per bot and per IP per day (`voiceSecondsPerDay`, `voiceSecondsPerIpPerDay`) plus `transcriptionsPerVisitorPerHour`. The embed page allows the microphone only for bots with voice.
