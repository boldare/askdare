---
"@boldare/askdare": minor
---

Add attachments. With `attachments: {}` in `defineBot`, visitors can attach images and PDFs through a paperclip button, paste or drag and drop. The widget downsizes and re-encodes images as JPEG (dropping EXIF and GPS data) before uploading. The server detects each file's type from its bytes (SVG and animated images are refused), caps its size (default 4 MB) and upload rate, stores it in OpenAI with a 30-day expiry, and hands the browser an encrypted, visitor-bound handle instead of the OpenAI file ID. Deleting a conversation also deletes its files. PDFs are charged by their page count, counted from the file (`maxPdfPages`, default 50). New limits: `uploadsPerVisitorPerHour`, `uploadsPerIpPerHour` and `uploadsPerDay`. A session renewal now keeps the visitor, so files uploaded before the first message stay usable.
