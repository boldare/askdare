---
'@boldare/askdare': patch
---

The config that `npx @boldare/askdare init` writes now reads three optional environment variables: `ASKDARE_INSTRUCTIONS` and `ASKDARE_GREETING` replace the bot's default instructions and greeting, and `ASKDARE_ALLOWED_ORIGINS` lists the other sites that may embed the chat, comma-separated. Without them the bot behaves as before. The one-click deploys of the starter ask for them.
