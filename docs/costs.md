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
| Moderation | Nothing extra today: OpenAI's moderation endpoint is free. Each checked message adds one call and its latency | Only bots with `moderation` make the call |
| `askdare doctor` | A 16-token response, plus one second of transcription for bots with voice, per bot and run | 3 runs a minute for the whole app |

## The worst case under the default limits

These defaults bound spending. All of them can be changed in `limits` ([Configuration](configuration.md#limits)).

| Limit | Default | Counted per |
| --- | --- | --- |
| `dailyTokens` | 2,000,000 input plus output tokens (cached input counts as a tenth) | bot, per UTC day |
| `dailyTokensPerIp` | 200,000 input plus output tokens (cached input counts as a tenth) | client IP and bot, per UTC day |
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

The budget counts input read from the prompt cache as a tenth of a token, and input, cache writes and output as whole tokens. OpenAI prices cached input at a tenth of input on most models, so one budget token never costs more than the most expensive of them. For a ceiling in money, use the highest per-token price of your model:

```text
highest price per 1M tokens = the highest of: input, cache writes, output, 10 × cached input
ceiling per bot per day     = 2,000,000 / 1,000,000 × highest price per 1M tokens
                            = 2 × highest price per 1M tokens
ceiling per bot per 30 days = 60 × highest price per 1M tokens
```

On current models the highest is usually output, and 10 × cached input equals input. Real spending is lower whenever some of the tokens are cheaper input or cached input. The ceiling is what an attacker with ten or more IP addresses can make you pay every day.

Long conversations are mostly cached input: every model call reads the whole conversation again, and the cache serves all of it but the newest part. We measured a 50-turn support conversation with knowledge searches at 97.9 % cached input. It used 3.8M input tokens, cost 0.31 USD, and counts as about 460,000 tokens against the budgets. One visitor can hold a conversation of about 28 turns like it on the default `dailyTokensPerIp`.

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
  one call = input tokens of the last model call of the previous message
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

## Tracking what the chat costs

[`onUsage`](configuration.md#onusage) receives every turn's tokens as OpenAI reports them: input, cached and cache-write input, output and reasoning, with the model that answered. Multiply them by your model's prices to get the cost per turn, per bot or per conversation, and send them to your metrics or, with `@boldare/askdare-otel`, to your tracing.

The report holds pseudonyms, never message text. A turn that breaks off mid-answer reports what askdare received, while OpenAI may bill a little more, so compare with the OpenAI dashboard now and then.

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
- askdare sends `truncation: 'auto'`. When a conversation outgrows the model's context window, OpenAI drops the oldest items instead of failing. OpenAI has deprecated the parameter but announced no shutdown date; askdare keeps sending it until then. If OpenAI ever refuses an overflowing conversation, the visitor sees "This conversation is too long. Please start a new one."
- With OpenAI's conversations (the default), askdare doesn't compact or summarize them. OpenAI's server-side compaction there cut answers off, ran on every turn and lost prompt caching in spikes [S5](https://github.com/boldare/askdare/blob/main/spikes/s5-compaction/README.md) and S5b ([ADR-0003](adr/0003-conversation-state.md)). With your own store, see [compaction](#long-conversations-and-compaction) below.
- Attached files and your tools' results stay in the conversation, so every later message reads them again. Keep tool results small ([Tools](tools.md)).
- **With your own [conversation store](custom-store.md#conversation-store)**, askdare sends the whole conversation itself with every model call (`store: false`), instead of OpenAI reading it from its copy. Requests get larger: spike S7 measured 32 KB at turn 20, 22 KB of it the model's encrypted reasoning, and about 5 % more input tokens. Almost all of it is read from the prompt cache, so the cost was the same: 0.0135 USD for 20 turns against 0.0138 USD with OpenAI's conversations. askdare sends no `truncation` then: `maxTurns` bounds the conversation, and one that still outgrows the context window ends with "This conversation is too long. Please start a new one."

### Long conversations and compaction

With a store that keeps the items, `limits.compactAt` has askdare compact a conversation after the turn that reaches it ([Configuration](configuration.md#compaction), [ADR-0029](adr/0029-compaction-for-item-stores.md)). OpenAI summarizes the conversation into one item, and the next turns replay that instead of everything before it. Spike S9 measured it on a 50-turn support conversation with knowledge searches, where 84 % of the replayed input was search results:

| | Without | With compaction |
| --- | --- | --- |
| Input of a turn late in the conversation | 80k tokens (`gpt-6.1-terra`) | 3–5k after each compaction, growing again from there |
| Cost of 50 turns, `gpt-6-luna` (measured, `compactAt: 20_000`) | 0.071 USD | 0.031 USD (−56 %) |
| Cost of 50 turns, `gpt-6.1-terra` (estimated from measured turns) | 0.307 USD | 0.246 USD at 60,000, 0.228 at 40,000, 0.223 at 20,000 (−20 to −27 %) |
| Tokens counted against the budgets (terra) | 3.8M | 2.5M at 60,000, 1.2M at 20,000 |

What one compaction costs:

- **One extra request.** It reads the turn's prompt cache, so on terra at 82k tokens it cost 0.0085 USD and wrote 862 output tokens. It takes up to about 15 s, after the answer, so nobody waits for it.
- **One cache miss.** The first model call after it starts from a new, short prefix (a few thousand tokens) that isn't cached yet.
- **Budgets.** askdare reserves the window as cached input plus 2,000 output tokens before it runs, and charges what it used, like a model call of the turn. It sets `max_output_tokens` to 20,000 because the API requires that for a compaction, but doesn't reserve it.

The savings are modest per token and larger for the budgets. A lower `compactAt` compacts more often: between 20,000 and 40,000 the cost barely changes, while the budgets keep saving. Start around 40,000 and look at the `compaction` entries in [`onUsage`](configuration.md#onusage). Conversations shorter than `compactAt` never compact, and cost what they did.

## Prompt caching

OpenAI caches the beginning of prompts automatically on supported models, and cached input tokens are billed at a lower rate. A cached part can only be reused when everything before it is identical.

- askdare sends `prompt_cache_key: "askdare:<bot id>"`, the same for every visitor of a bot, so their requests can share a cache.
- Start the instructions with text that is the same for every visitor. Put what varies, such as the locale or a signed-in user's name, at the end.
- Keep the tool list stable. askdare already keeps it the same on every model call of a message.

askdare's budgets count input read from the prompt cache as a tenth of a token, close to its price, so they last longer when caching works ([Tokens](#tokens)). The estimate reserved before each model call still counts the conversation so far as whole tokens, in case the cache has gone cold. OpenAI's [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) lists the minimum prompt length that can be cached.

## Reply options

With `widget.replies: 'suggest'`, the model can offer clickable replies under an answer ([Reply options](reply-options.md)). That costs tokens in two ways:

- **The tool's definition is input on every model call:** about 250 tokens, estimated from its length. It sits in the stable part of the prompt, so on models with prompt caching it is mostly billed as cached input after the first message.
- **Sometimes one more model call.** When the model suggests replies after writing its answer, the server answers the call itself and the message ends: no extra call. When it suggests them before answering (or marks its text as an intermediate update, as GPT-5.4 and later can before a tool call), the message takes one more call. That call reads the whole conversation again (mostly cached input) and adds the latency of one request. The options themselves are a few dozen output tokens.

The extra call counts against `maxSteps` and the budgets like a tool round: askdare reserves it before each call that may suggest replies, and when a budget can't hold it, or on a bot with `maxSteps: 1`, the model answers without options. Compare `steps` and the tokens in [`onUsage`](configuration.md#onusage) with and without the setting to see what it costs with your model and traffic.

## Knowledge base

- `knowledge.maxResults` (default 5) is how many chunks the model reads per search. askdare reserves 800 tokens per chunk, 4,000 per message by default.
- Each file search call has its own fee, and the vector store is billed for storage per GB per day above a free allowance. Neither is in askdare's budgets. askdare doesn't limit how many searches the model makes per message; the token budget limits them indirectly, because every search adds input tokens.
- With [your own index](knowledge-base.md#your-own-index) there is no per-search fee and no vector store storage: each search is one embedding request for the query and one database query, and an answer that searches takes two model calls. [Own your data](own-your-data.md#costs-and-latency) has the measurements.
- See [Knowledge base](knowledge-base.md).

## Attachments

- askdare reserves about 1,500 tokens per image and 2,000 per PDF page before the message. A 50-page PDF reserves 100,000 tokens, half of the default `dailyTokensPerIp`.
- Every model call reads the files again. A bot with tools reserves the files once per call it actually makes, so a large PDF can mean the model answers without calling tools when the visitor's budget can't hold another call.
- Keep attachments off for bots that don't need them, and lower `maxPdfPages` if long PDFs aren't expected. See [Attachments](attachments.md).

## Moderation

- A bot with `moderation` makes one call to OpenAI's moderation endpoint per checked message: one before the turn for `check: 'input'`, one after the answer for `'output'`, two for `'both'`. Bots without it make none.
- The endpoint is free to use at the time of writing ([OpenAI's moderation guide](https://developers.openai.com/api/docs/guides/moderation)), so it adds latency, not tokens, and isn't in askdare's budgets. Check the pricing page again if that changes.
- Checking output holds each answer back until it is complete, so visitors wait longer before they see anything. A blocked answer has still spent its tokens, and they count against the budgets. See [Guardrails](guardrails.md).

## Voice input

- Transcription is billed per minute of audio for models that report a duration. askdare reserves `voice.maxSeconds` (default 60) per dictation and then charges the duration OpenAI reports.
- Models billed by tokens report no duration. askdare then charges the longest audio the recording could hold, so prefer a model billed by duration.
- A dictation OpenAI refuses with an error isn't charged against the speech budget. See [Voice input](voice-input.md).
