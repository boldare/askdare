---
'@boldare/askdare': minor
---

A tool can offer clickable reply options derived from its result: `defineTool({ replies: (result) => ['Track the parcel', 'Talk to a person'] })`. `replies` gets the successful result as the model received it (parsed back from JSON) and is typed from `execute`; the options come back after a reload, from the stored call. The same limits as every reply option apply: at most four, up to 80 characters, plain text without links. Only the options reach the browser, never the tool's result (ADR-0015).
