---
'@boldare/askdare': minor
---

The config that `npx @boldare/askdare init` writes now reads three optional environment variables. `ASKDARE_INSTRUCTIONS` and `ASKDARE_GREETING` replace the bot's default instructions and greeting, and `ASKDARE_ALLOWED_ORIGINS` lists the other sites that may embed the chat, comma-separated. Blank values fall back to the defaults, and trailing slashes are dropped from origins. Without the variables the bot behaves as before. The starter's Vercel button asks for the instructions and greeting, and its Heroku `app.json` offers all three.
