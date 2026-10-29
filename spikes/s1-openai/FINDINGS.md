# Spike S1: Responses + Conversations API in practice

- **Date:** 2026-10-29
- **Model:** `gpt-6.1-terra`
- **SDK:** `openai` 7.45.1
- **Run:** `pnpm start` in this folder. Raw output is in `results.json`; recorded streams are in `fixtures/`.
- **Cost:** 2,635 input + 244 output tokens across 14 experiments. Every conversation, file and vector store created was deleted (13 of 13).

**Verdict: GO for ADR-0003** (conversations stored in the OpenAI Conversations API), with the amendments below.

## Results

| # | Question | Result | Consequence for chatdock |
|---|---|---|---|
| E1–E2 | Streaming a turn inside a conversation | Works. Time to first token 0.87 s for the first turn and 1.26 s with history; input tokens grow with history (21 → 45). Event order matches what our mapper expects. | No change |
| E3 | `conversations.items.list` | Returns only the user and assistant `message` items for plain chats. Default order is **descending**, so we must pass `order: 'asc'`. **It took about 1.9 s.** | History on reload needs a loading state (step 3.1); don't call it on every turn |
| E4 | Function-call loop in a conversation | Works: `function_call` item, then `function_call_output` input, then the final answer uses the tool result. | Basis for step 3.2 |
| E5 | Dangling function call | The next turn fails with **400 "No tool output found for function call call_…"** (`param: input`). Sending a synthetic `function_call_output` together with the new user message **repairs** it. | The step 3.2 tool loop must always answer every call. On this 400 it repairs with a synthetic error output and retries once |
| E6 | `file_search` with citations | Works. A single `response.output_text.annotation.added` event with `file_citation {file_id, filename, index}` arrives after the deltas. File processing took about 10 s; time to first token was 2.7 s; retrieval added about 2k input tokens. | Our mapper produces the right `citation` event (also covered by recorded-stream tests). Expect slower first tokens for knowledge-base bots |
| E7 | Image as `input_image` via `file_id` | Works with purpose **`vision`** and also with **`user_data`**. | Use `user_data` for every attachment (one purpose, one cleanup path) |
| E8 | PDF as `input_file` via `file_id` | Works with `user_data`; the text in the PDF was read correctly. | Basis for step 3.4 |
| E9 | Turn after the conversation's image file was deleted | Works; the conversation continued without errors. | Expiring or deleting attachment files does not break conversations, so `expires_after` is safe |
| E10 | `store: false` together with `conversation` | The request **succeeds, but the turn is silently not added to the conversation** (2 items before and after). | Never send `store: false` with a conversation. The gateway always uses `store: true`; documented in the `openai-api` skill |
| E11 | Turn on a deleted conversation | **404** with `code: null` and the message "Conversation with id '…' not found." | Maps to `not_found`; the widget then starts a new conversation |
| E12 | Reasoning | A `reasoning` output item is added and done before the message; no summary events unless requested. | Our `reasoning` started/done status works |
| E13 | Unknown model | **404** with `code: 'model_not_found'`. | **Bug found:** we mapped every 404 to "conversation gone". Fixed: `model_not_found` → `bot_unavailable` |

## Follow-ups

- **Fixed now:** 404 mapping (E13), plus recorded-stream replay tests in `packages/chatdock/src/openai/recorded.test.ts`.
- **Step 3.1:** history via `items.list({ order: 'asc' })`, with a loading state (about 2 s).
- **Step 3.2:** tool loop answers every call; repairs dangling calls on the 400 from E5.
- **Step 3.4:** attachments use purpose `user_data` with `expires_after`.
- **Not measured here:** prompt caching (inputs were below the caching threshold) and behaviour at 429 or 5xx (they can't be triggered on demand).
