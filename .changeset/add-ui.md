---
'@boldare/askdare': minor
---

New command `npx @boldare/askdare add ui`: copies the source of the chat's default look (React components and their stylesheet) into `components/askdare`, or the folder given with `--dir`, so you can change it freely. It never overwrites files. The copy imports only `@boldare/askdare/react`, and you switch to it by changing one import of `DefaultChat`.
