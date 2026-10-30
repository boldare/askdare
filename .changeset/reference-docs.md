---
'@boldare/askdare': patch
'@boldare/askdare-upstash': patch
---

Reference documentation: configuration, embedding, CLI, troubleshooting, costs, privacy, texts, custom rate-limit stores and migrating from `@boldare/openai-assistant`. The package now also ships the `askdare` skill for AI coding agents (`skills/askdare/`), and the Upstash add-on has a README.

Smaller fixes: `init` accepts only bot IDs that `defineBot` accepts, every secret error suggests the same `node -e` command, the CLI help names the env files `doctor` really reads and spells commands as `npx @boldare/askdare`, and the loader's fallback "couldn't load" text matches the translated one.
