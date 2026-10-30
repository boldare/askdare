---
"@boldare/askdare": patch
---

`askdare kb sync` keeps going when one file fails: the failure is reported, the half-uploaded file is deleted, and the other files still sync. Copies that never finished processing are uploaded again. `.mdx` and `.htm` files are uploaded under the `.md` and `.html` names that OpenAI file search accepts. Reloaded history now cites a retagged file by its newest title and URL.
