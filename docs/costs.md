# Costs

Every message in the chat spends tokens in your OpenAI project, and anyone on the internet can send messages. This page shows the most a deployment can spend under the default limits, and the settings that change that number.

Prices change often, so this page counts tokens, seconds and files. To turn them into money, multiply by your model's current prices on [OpenAI's pricing page](https://developers.openai.com/api/docs/pricing).

## What you pay for

| What | OpenAI bills | What bounds it in askdare |
| --- | --- | --- |
| Messages | Input and output tokens. Reasoning tokens are billed as output tokens | Daily token budgets per bot, per IP and optionally for all bots |
| Knowledge base | Retrieved chunks as input tokens, a fee per file search call, and vector store storage per GB per day above a free allowance | Only the tokens are in the budgets |
| Attachments | Images and PDF pages as input tokens, when they are sent | The token budgets, plus upload limits |
| Voice input | Transcription, per minute of audio (some models bill by tokens instead) | Daily speech budgets in seconds |
| `askdare doctor` | A 16-token response, plus one second of transcription for bots with voice, per bot and run | 3 runs a minute for the whole app |

## The worst case under the default limits

These defaults bound spending. All of them can be changed in `limits` ([Configuration](configuration.md#limits)).

| Limit | Default | Counted per |
| --- | --- | --- |
| `dailyTokens` | 2,000,000 input plus output tokens | bot, per UTC day |
| `dailyTokensPerIp` | 200,000 input plus output tokens | client IP and bot, per UTC day |
| `globalDailyTokens` (in `createChatHandler`) | none | all bots, per UTC day |
| `maxOutputTokens` | 1,024 | model call |
| `maxSteps` | 5 model calls | message |
| `maxInputChars` | 4,000 characters | message |
| `maxTurns` | 50 messages | conversation |
| `messagesPerVisitorPerMinute` | 10 | visitor |
| `messagesPerIpPerMinute` | 30 | client IP |
| `voiceSecondsPerDay` | 3,600 seconds | bot, per UTC day |
| `voiceSecondsPerIpPerDay` | 600 seconds | client IP and bot, per UTC day |
| `uploadsPerDay` | 500 files | bot, per UTC day |
| `attachments.maxBytes` | 4,000,000 bytes | file |

### Tokens

The bot's daily budget is the ceiling, however many visitors there are:

```text
one bot, one day           2,000,000 tokens
one IP, one day              200,000 tokens  (10 IPs use up the bot's budget)
one bot, 30 days      30 × 2,000,000 = 60,000,000 tokens
three bots, one day    3 × 2,000,000 =  6,000,000 tokens  (unless you set globalDailyTokens)
```

The budget counts input, cached input and output tokens alike, but OpenAI prices them differently. For a ceiling in money, use the highest per-token price of your model:

```text
ceiling per bot per day    = 2,000,000 / 1,000,000 × highest price per 1M tokens
                           = 2 × highest price per 1M tokens
ceiling per bot per 30 days = 60 × highest price per 1M tokens
```

Real spending is lower whenever some of the tokens are cheaper input or cached input. The ceiling is what an attacker with ten or more IP addresses can make you pay every day.

### Speech

```text
one bot, one day            3,600 seconds = 60 minutes
one IP, one day               600 seconds = 10 minutes
one bot, 30 days       30 × 60 minutes    = 1,800 minutes
```

Multiply by the transcription model's price per minute.

### Files

Uploads cost no tokens until they are sent, and sent files count against the token budgets. They do take up storage in your OpenAI project:

```text
one bot, one day      500 files × 4 MB = 2 GB
files expire after 30 days, so at most 30 × 500 = 15,000 files (60 GB) per bot at once
```

Check OpenAI's pricing page for how file storage is billed.

## When spending can go over the budget

The budgets are checked before each message. A few things let the real number end up higher:

- **Several instances with the default store.** Counters live in each instance's memory, so every instance allows the full budget, and a restart or deployment resets them. With more than one instance, use `@boldare/askdare-upstash` ([Going public](going-public.md#4-rate-limits-across-instances)).
- **A message can use somewhat more than it reserved.** Before each model call, askdare reserves an estimate of that call against every budget:

  ```text
  one call = input tokens of the previous message in this conversation
           + characters of the instructions, message and page context / 2
           + maxOutputTokens
           + tokens of the attached files
           + maxResults × 800 (with a knowledge base)
  ```

  The first call is reserved before the message starts. A bot with tools reserves one more call before each round of tool calls; when a budget can't hold it, the model answers without tools instead. When the message ends, the reservations are replaced by the real usage. Tool results and the model's own earlier output in the same message aren't in the estimate, so the counter can end slightly above the budget; the next message is then refused.
- **A message that fails, or is cut off by `turnTimeoutMs`, stays charged at its estimate,** whatever it really cost.
- **Dictations in progress** can go over the day's speech budget once, before further dictation is blocked.
- **The budgets count tokens only.** File search call fees, vector store storage, file storage, `doctor` runs and `kb sync` are not in them.

## The OpenAI hard limit

The budgets are the main cost control. The backstop is a **monthly budget with "Enforce a hard limit"** on the OpenAI project, with email alerts ([Going public](going-public.md#1-openai-project)). Set it a little above what your askdare budgets allow in a month, so that the budgets stop spending first and the hard limit catches anything they miss.

When the project reaches its limit, OpenAI refuses requests. Visitors see "The assistant is temporarily unavailable. Please try again." (`upstream_error`), and `npx @boldare/askdare doctor` reports "The OpenAI project is out of credit or reached its spend limit."

## Budgets reset at midnight UTC

Daily budgets count per UTC day and reset at 00:00 UTC, not at midnight where you are. A visitor who hits one sees "The assistant is unavailable for the rest of the day." (`budget_exceeded`), with a `Retry-After` header that counts down to 00:00 UTC.

Rate limits work differently: each window (a minute or an hour) starts with the first request it counts.

## Setting the budgets

1. Decide what a day may cost, per bot.
2. Divide it by your model's highest per-token price. That is `dailyTokens`.
3. Decide how much of it one visitor's IP may take. The default is a tenth (`dailyTokensPerIp`).
4. With several bots, cap them together with `globalDailyTokens` in `createChatHandler`.
5. Run a few typical conversations and compare the usage in the OpenAI dashboard with your estimate. Adjust after the first days of real traffic.

```ts
defineBot({
  // …
  limits: { dailyTokens: 1_000_000, dailyTokensPerIp: 50_000 },
});

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  limits: { globalDailyTokens: 3_000_000 },
});
```

## Choosing a model

The model decides most of the bill, which is why askdare never picks one for you.

- **Smaller, cheaper models** are often enough for answers from your documents and short questions. Start with the cheapest model that answers your test questions well.
- **Reasoning models** think before they answer. Their reasoning tokens are billed as output tokens and count toward `maxOutputTokens`. askdare doesn't set a reasoning effort, so the model's default applies.
- Put only the model you chose on the project's model allowlist, so a changed config can't switch to a more expensive one by accident.

## `maxOutputTokens` and reasoning

`limits.maxOutputTokens` (default 1,024) caps each model call's output, reasoning included.

- Raising it raises the most a single call can cost, and the reservation of every message.
- Lowering it too far cuts answers off. With a reasoning model, the reasoning can use up the whole limit before any visible text: OpenAI still bills the input and reasoning tokens, and the visitor gets an empty or cut-off answer.

## Long conversations

A conversation is stored by OpenAI, and every message sends the whole conversation to the model as input. Each message therefore costs more than the one before.

- `maxTurns` (default 50) ends a conversation: the visitor is asked to start a new one.
- askdare sends `truncation: 'auto'`. When a conversation outgrows the model's context window, OpenAI drops the oldest items instead of failing.
- askdare doesn't compact or summarize conversations yet. OpenAI's server-side compaction is planned for 0.2.
- Attached files and your tools' results stay in the conversation, so every later message reads them again. Keep tool results small ([Tools](tools.md)).

## Prompt caching

OpenAI caches the beginning of prompts automatically on supported models, and cached input tokens are billed at a lower rate. A cached part can only be reused when everything before it is identical.

- askdare sends `prompt_cache_key: "askdare:<bot id>"`, the same for every visitor of a bot, so their requests can share a cache.
- Start the instructions with text that is the same for every visitor. Put what varies, such as the locale or a signed-in user's name, at the end.
- Keep the tool list stable. askdare already keeps it the same on every model call of a message.

askdare's budgets count cached tokens in full, so they overestimate the cost when caching works. OpenAI's [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) lists the minimum prompt length that can be cached.

## Knowledge base

- `knowledge.maxResults` (default 5) is how many chunks the model reads per search. askdare reserves 800 tokens per chunk, 4,000 per message by default.
- Each file search call has its own fee, and the vector store is billed for storage per GB per day above a free allowance. Neither is in askdare's budgets. askdare doesn't limit how many searches the model makes per message; the token budget limits them indirectly, because every search adds input tokens.
- See [Knowledge base](knowledge-base.md).

## Attachments

- askdare reserves about 1,500 tokens per image and 2,000 per PDF page before the message. A 50-page PDF reserves 100,000 tokens, half of the default `dailyTokensPerIp`.
- Every model call reads the files again. A bot with tools reserves the files once per call it actually makes, so a large PDF can mean the model answers without calling tools when the visitor's budget can't hold another call.
- Keep attachments off for bots that don't need them, and lower `maxPdfPages` if long PDFs aren't expected. See [Attachments](attachments.md).

## Voice input

- Transcription is billed per minute of audio for models that report a duration. askdare reserves `voice.maxSeconds` (default 60) per dictation and then charges the duration OpenAI reports.
- Models billed by tokens report no duration. askdare then charges the longest audio the recording could hold, so prefer a model billed by duration.
- A dictation OpenAI refuses with an error isn't charged against the speech budget. See [Voice input](voice-input.md).
