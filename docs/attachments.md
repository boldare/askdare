# Attachments

Visitors can attach images and PDFs to their messages. The model sees images and reads PDFs (their text and page images).

## Turn it on

```ts
defineBot({
  // …
  attachments: {}, // images and PDFs, up to 4 MB, 3 per message
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `images` | `true` | PNG, JPEG, WebP and GIF |
| `pdf` | `true` | PDF documents |
| `maxBytes` | `4_000_000` | Largest file. 4 MB fits Vercel's 4.5 MB request body limit; raise it only on hosts without one |
| `maxPerMessage` | `3` | Files per message (up to 10) |

Upload rates are limited per visitor and per IP (`limits.uploadsPerVisitorPerHour`, default 20, and `limits.uploadsPerIpPerHour`, default 60).

## What the widget does

- A paperclip button opens the file picker. Files can also be pasted or dropped onto the chat.
- Images are downsized to 2048 px on the long edge and re-encoded as JPEG in the browser. That keeps uploads small, drops EXIF data such as the GPS position, and converts HEIC photos where the browser can decode them.
- Each file is uploaded as soon as it is chosen; the message is sent once every upload has finished.

## What the server does

- Detects the type from the file's bytes, never from its name or Content-Type. SVG, animated GIFs and anything else are refused.
- Uploads the file to OpenAI with purpose `user_data`. Files expire after 30 days, and are deleted earlier when the visitor deletes the conversation.
- Returns an encrypted handle instead of the OpenAI file ID. Handles are bound to the bot and the visitor and expire after 1 hour.
- Reserves tokens for the files before the turn, so large PDFs count against the daily budgets up front.

After a page reload the conversation shows how many files a message had, not the files themselves: OpenAI does not let you download `user_data` files.

## Privacy

Uploaded files are stored by OpenAI under your project until they expire or are deleted. Mention this in your privacy policy, and keep attachments off for bots that don't need them.
