---
'@boldare/askdare': patch
---

Closing the chat from inside it returns keyboard focus to the page in Firefox too, not only in Chromium. `doctor` and `init` no longer report `.env.local` as not ignored in a project without git when its `.gitignore` has folder negations such as `!.yarn/patches`, as create-next-app's does.
