---
'@boldare/askdare': patch
---

Answers no longer show the same citation marker twice in a row: `[1] [1]` and `[1][1]` become `[1]`, while streaming and in reloaded history. A Responses-compatible server that leaves out the optional usage details (`input_tokens_details`, `output_tokens_details`) no longer fails the turn; the missing counts are reported as 0.
