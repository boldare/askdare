/**
 * Spike S6b: askdare's turn through the `openai` SDK against Open Responses endpoints.
 *
 *   pnpm install --ignore-workspace
 *   pnpm start <endpoint|all> [experiment…]
 *
 * Endpoints: or-haiku, or-haiku-cc (OpenRouter + top-level cache_control), or-oss, hf-oss,
 * ollama (local, qwen3:4b), openai-terra (baseline). Reads keys from .env, never prints them. Results are merged into
 * results.json, redacted streams go to fixtures/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import OpenAI, { APIError } from 'openai';
import type { ResponseInputItem, ResponseStreamEvent } from 'openai/resources/responses/responses';
import {
  add,
  type BotConfig,
  botTools,
  type Endpoint,
  INSTRUCTIONS,
  listUsd,
  mapError,
  type Price,
  type ProtocolEvent,
  responseTools,
  runStep,
  runTurn,
  type StepRecord,
  SUGGEST_REPLIES,
  type TokenUsage,
  ZERO,
} from './turn.ts';

const BUDGET_USD = 2.8;

// Model IDs and URLs live in this spike only. Prices per 1M tokens, checked 2026-11-23:
// OpenRouter model pages; OpenAI https://developers.openai.com/api/docs/pricing (as in S5b).
const HAIKU: Price = { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 };
/** gpt-oss-120b: provider prices vary (0.03–0.15 in, 0.15–0.60 out); worst case used for the budget. */
const OSS: Price = { input: 0.15, cached: 0.15, write: 0.15, output: 0.6 };
const TERRA: Price = { input: 1, cached: 0.05, write: 1.25, output: 5 };

function key(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

const common = { maxRetries: 1, timeout: 120_000 } as const;
const openrouter = key('OPENROUTER_API_KEY')
  ? new OpenAI({ ...common, apiKey: key('OPENROUTER_API_KEY'), baseURL: 'https://openrouter.ai/api/v1' })
  : undefined;
const hf = key('HF_TOKEN')
  ? new OpenAI({ ...common, apiKey: key('HF_TOKEN'), baseURL: 'https://router.huggingface.co/v1' })
  : undefined;
/** Local Ollama: no key, free; the price table only keeps the budget code uniform. */
const ollama = new OpenAI({ ...common, apiKey: 'ollama', baseURL: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1' });
const FREE: Price = { input: 0, cached: 0, write: 0, output: 0 };
const openai = key('OPENAI_API_KEY') ? new OpenAI({ ...common, apiKey: key('OPENAI_API_KEY') }) : undefined;

const ENDPOINTS: Record<string, () => Endpoint | undefined> = {
  'or-haiku': () =>
    openrouter && { name: 'or-haiku', client: openrouter, model: 'anthropic/claude-haiku-5.5', price: HAIKU, includeReasoning: true },
  'or-haiku-cc': () =>
    openrouter && {
      name: 'or-haiku-cc',
      client: openrouter,
      model: 'anthropic/claude-haiku-5.5',
      price: HAIKU,
      includeReasoning: true,
      extra: { cache_control: { type: 'ephemeral' } },
    },
  'or-oss': () =>
    openrouter && { name: 'or-oss', client: openrouter, model: 'openai/gpt-oss-120b', price: OSS, includeReasoning: true },
  'hf-oss': () => hf && { name: 'hf-oss', client: hf, model: 'openai/gpt-oss-120b', price: OSS, includeReasoning: true },
  'ollama': () => ({ name: 'ollama', client: ollama, model: process.env['OLLAMA_MODEL'] ?? 'qwen3:4b', price: FREE, includeReasoning: true }),
  'openai-terra': () =>
    openai && { name: 'openai-terra', client: openai, model: 'gpt-6.1-terra', price: TERRA, includeReasoning: true },
};

// ---------------------------------------------------------------- bookkeeping

const results: Record<string, Record<string, unknown>> = existsSync('results.json')
  ? (JSON.parse(readFileSync('results.json', 'utf8')) as Record<string, Record<string, unknown>>)
  : {};
let spentUsd = 0;

/** Reported cost when the endpoint gives one, else list price. */
function usd(u: TokenUsage, p: Price): number {
  return u.reportedCostUsd > 0 ? u.reportedCostUsd : listUsd(u, p);
}
function charge(endpoint: Endpoint, u: TokenUsage): void {
  spentUsd += usd(u, endpoint.price);
  if (spentUsd > BUDGET_USD) throw new Error(`Budget: ${spentUsd.toFixed(3)} USD spent in this run`);
}
const round = (n: number | undefined): number | undefined => (n === undefined ? undefined : Math.round(n));
const median = (xs: number[]): number => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

function collect(): { events: ProtocolEvent[]; emit: (e: ProtocolEvent) => void } {
  const events: ProtocolEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}
function summarize(events: ProtocolEvent[]): unknown[] {
  const out: { type: string; delta?: string }[] = [];
  for (const e of events) {
    const prev = out.at(-1);
    if (e.type === 'text.delta' && prev?.type === 'text.delta') prev.delta += e.delta;
    else out.push({ ...e, messageId: undefined } as unknown as { type: string });
  }
  return out;
}

/** Redacts encrypted reasoning and signatures; ids and our own test text stay. */
function fixture(name: string, steps: StepRecord[]): void {
  mkdirSync('fixtures', { recursive: true });
  writeFileSync(
    `fixtures/${name}.json`,
    JSON.stringify(
      steps.map((s) => s.rawEvents),
      (k, v: unknown) => (['encrypted_content', 'signature'].includes(k) && typeof v === 'string' ? '<redacted>' : v),
      1,
    ),
  );
}

// ---------------------------------------------------------------- conformance against the spec

/** Streaming events of the Open Responses reference, 2026-04-24. */
const SPEC_EVENTS = new Set([
  'error',
  'response.completed',
  'response.content_part.added',
  'response.content_part.done',
  'response.created',
  'response.failed',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'response.incomplete',
  'response.in_progress',
  'response.output_item.added',
  'response.output_item.done',
  'response.output_text.annotation.added',
  'response.output_text.delta',
  'response.output_text.done',
  'response.queued',
  'response.reasoning.delta',
  'response.reasoning.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.refusal.delta',
  'response.refusal.done',
]);

/** What in the raw stream differs from what the library's mapper and loop rely on. */
function conformance(steps: StepRecord[]): Record<string, unknown> {
  const outsideSpec = new Set<string>();
  const issues = new Set<string>();
  const phases = new Set<string>();
  const itemTypes = new Set<string>();
  for (const step of steps) {
    const events = step.rawEvents as (ResponseStreamEvent & Record<string, unknown>)[];
    let lastSeq = -1;
    for (const e of events) {
      if (!SPEC_EVENTS.has(e.type)) outsideSpec.add(e.type);
      const seq = e['sequence_number'];
      if (typeof seq !== 'number') issues.add(`no sequence_number on ${e.type}`);
      else if (seq <= lastSeq) issues.add('sequence_number not increasing');
      else lastSeq = seq;
      if (e.type === 'response.output_item.added' || e.type === 'response.output_item.done') {
        const item = e.item as unknown as Record<string, unknown>;
        itemTypes.add(String(item['type']));
        if (item['type'] === 'message') {
          phases.add(item['phase'] === undefined ? '(absent)' : String(item['phase']));
          if (!item['id']) issues.add('message item without id');
        }
        if (item['type'] === 'function_call' && e.type === 'response.output_item.done') {
          if (!item['call_id']) issues.add('function_call without call_id');
          if (!item['id']) issues.add('function_call without id');
        }
      }
      if (e.type === 'response.completed' || e.type === 'response.incomplete') {
        const r = e.response as unknown as Record<string, unknown>;
        const u = r['usage'] as Record<string, unknown> | null | undefined;
        if (!u) issues.add('terminal event without usage');
        else {
          if (!u['input_tokens_details']) issues.add('usage without input_tokens_details (library throws)');
          if (!u['output_tokens_details']) issues.add('usage without output_tokens_details');
          const d = u['input_tokens_details'] as Record<string, unknown> | undefined;
          if (d && d['cache_write_tokens'] === undefined) issues.add('no cache_write_tokens');
        }
        if (!r['model']) issues.add('terminal response without model');
      }
    }
    const last = events.at(-1)?.type;
    if (!['response.completed', 'response.incomplete', 'response.failed'].includes(String(last))) {
      issues.add(`stream ends with ${last}`);
    }
  }
  return {
    eventTypes: steps.map((s) => s.eventTypes),
    outsideSpec: [...outsideSpec],
    issues: [...issues],
    messagePhases: [...phases],
    itemTypes: [...itemTypes],
    models: steps.map((s) => s.outcome.model),
    usage: steps.map((s) => s.outcome.usage),
  };
}

function errorInfo(error: unknown): Record<string, unknown> {
  const mapped = mapError(error);
  if (error instanceof APIError) {
    const body = error.error as Record<string, unknown> | undefined;
    return {
      class: error.constructor.name,
      status: error.status,
      code: error.code,
      type: error.type,
      message: String(error.message).slice(0, 300),
      bodyKeys: body ? Object.keys(body) : undefined,
      retryAfter: error.headers?.get('retry-after') ?? undefined,
      mapped,
    };
  }
  const e = error as Error;
  return { class: e?.constructor?.name, message: String(e?.message).slice(0, 300), cause: e?.cause, mapped };
}

const BOT: BotConfig = { suggest: true, maxSteps: 5, maxOutputTokens: 1024 };

// ---------------------------------------------------------------- experiments

type Experiment = (ep: Endpoint) => Promise<unknown>;

const experiments: Record<string, Experiment> = {
  /** Q1: a plain answer, three times: the protocol, the raw events, time to first text. */
  async stream(ep) {
    const runs = [];
    const all: StepRecord[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { events, emit } = collect();
      const turn = await runTurn({
        endpoint: ep,
        bot: BOT,
        history: [],
        text: 'Hi! Who are you, in one sentence?',
        messageId: 'm1',
        emit,
        onStep: (s) => charge(ep, s.outcome.usage),
      });
      all.push(...turn.steps);
      if (i === 0) fixture(`${ep.name}-stream`, turn.steps);
      runs.push({
        reason: turn.reason,
        steps: turn.steps.length,
        firstTextMs: round(turn.steps[0]?.timing.firstTextMs),
        totalMs: round(turn.steps.reduce((a, s) => a + s.timing.totalMs, 0)),
        replies: turn.replies,
        protocol: i === 0 ? summarize(events) : undefined,
      });
    }
    return { medianFirstTextMs: median(runs.map((r) => r.firstTextMs ?? NaN)), runs, conformance: conformance(all) };
  },

  /** Q2: parallel calls (one failing on purpose), strict arguments, replies, the whole loop. */
  async tools(ep) {
    const { events, emit } = collect();
    const history: ResponseInputItem[] = [];
    const turn = await runTurn({
      endpoint: ep,
      bot: BOT,
      history,
      text: 'What time is it now in Warsaw and in Tokyo, and how much is 100 EUR in PLN?',
      messageId: 'm1',
      emit,
      onStep: (s) => charge(ep, s.outcome.usage),
    });
    fixture(`${ep.name}-tools`, turn.steps);
    return {
      reason: turn.reason,
      steps: turn.steps.map((s) => ({
        choice: s.choice,
        calls: s.outcome.functionCalls.map((c) => ({
          name: c.name,
          validArgs: validArgs(c.name, c.arguments),
          args: c.arguments,
        })),
        output: s.outcome.output.map((o) => o.type),
        status: s.outcome.status,
        incomplete: s.outcome.incompleteReason,
      })),
      parallelInOneStep: turn.steps.some(
        (s) => s.outcome.functionCalls.filter((c) => c.name !== SUGGEST_REPLIES).length > 1,
      ),
      replies: turn.replies,
      text: turn.text,
      protocol: summarize(events),
      conformance: conformance(turn.steps),
    };
  },

  /** Q2: the forced last step ('none'), and allowed_tools without suggest_replies. */
  async finalStep(ep) {
    const out: Record<string, unknown> = {};
    {
      const { emit } = collect();
      try {
        const turn = await runTurn({
          endpoint: ep,
          bot: { ...BOT, maxSteps: 1 },
          history: [],
          text: 'What time is it now in Warsaw?',
          messageId: 'm1',
          emit,
          onStep: (s) => charge(ep, s.outcome.usage),
        });
        out['none'] = {
          reason: turn.reason,
          choice: turn.steps[0]?.choice,
          calls: turn.steps.flatMap((s) => s.outcome.functionCalls.map((c) => c.name)),
          output: turn.steps.flatMap((s) => s.outcome.output.map((o) => o.type)),
          text: turn.text,
        };
      } catch (error) {
        out['none'] = { error: errorInfo(error) };
      }
    }
    // A later step after the model suggested replies: only bot tools allowed, suggest_replies listed.
    for (const attempt of [1, 2]) {
      const { emit } = collect();
      try {
        const s = await runStep({
          endpoint: ep,
          bot: BOT,
          instructions: INSTRUCTIONS,
          input: [{ role: 'user', content: 'Which plans do you have? Then suggest some replies for me to click.' }],
          choice: { type: 'allowed_tools', mode: 'auto', tools: botTools.map((t) => ({ type: 'function', name: t.name })) },
          messageId: 'm1',
          emit,
        });
        charge(ep, s.outcome.usage);
        out[`allowedTools${attempt}`] = {
          calls: s.outcome.functionCalls.map((c) => c.name),
          suggestRepliesCalledAnyway: s.outcome.functionCalls.some((c) => c.name === SUGGEST_REPLIES),
        };
      } catch (error) {
        out[`allowedTools${attempt}`] = { error: errorInfo(error) };
      }
    }
    return out;
  },

  /** Q2: is strict enforced? A strict tool whose schema is not strict-valid, and a required call. */
  async strict(ep) {
    const out: Record<string, unknown> = {};
    const probe = async (label: string, body: Record<string, unknown>): Promise<void> => {
      try {
        const r = await ep.client.responses.create({
          model: ep.model,
          input: 'What is the weather in Paris? Use the tool.',
          store: false,
          max_output_tokens: 300,
          ...body,
        } as never);
        const response = r as unknown as { output: { type: string; arguments?: string }[]; usage?: { input_tokens: number; output_tokens: number; cost?: number } };
        if (response.usage) {
          charge(ep, {
            ...ZERO,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            reportedCostUsd: response.usage.cost ?? 0,
          });
        }
        const rr = r as unknown as { status?: string; error?: unknown };
        out[label] = { accepted: true, status: rr.status, error: rr.error, output: response.output.map((o) => (o.type === 'function_call' ? `function_call ${o.arguments}` : o.type)) };
      } catch (error) {
        out[label] = { accepted: false, error: errorInfo(error) };
      }
    };
    // OpenAI refuses strict schemas without additionalProperties:false and with optional fields.
    await probe('looseSchemaStrict', {
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Weather for a city.',
          strict: true,
          parameters: { type: 'object', properties: { city: { type: 'string' }, unit: { type: 'string' } }, required: ['city'] },
        },
      ],
    });
    await probe('requiredChoice', {
      tools: responseTools(BOT).slice(0, 1).concat([
        {
          type: 'function',
          name: 'get_weather',
          description: 'Weather for a city.',
          strict: true,
          parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false },
        },
      ]),
      tool_choice: 'required',
    });
    return out;
  },

  /** Q3: errors and what today's mapping makes of them; request fields the spec or provider refuses. */
  async errors(ep) {
    const out: Record<string, unknown> = {};
    const base = { model: ep.model, input: 'Say OK.', max_output_tokens: 50, store: false } as const;
    const tryIt = async (label: string, run: () => Promise<unknown>): Promise<void> => {
      try {
        const r = (await run()) as { usage?: { input_tokens: number; output_tokens: number; cost?: number }; output?: { type: string }[] };
        if (r?.usage) {
          charge(ep, { ...ZERO, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, reportedCostUsd: r.usage.cost ?? 0 });
        }
        const rr = r as unknown as { status?: string; error?: unknown; model?: string };
        out[label] = { accepted: true, status: rr?.status, error: rr?.error, model: rr?.model, output: r?.output?.map((o) => o.type) };
      } catch (error) {
        out[label] = { accepted: false, error: errorInfo(error) };
      }
    };
    await tryIt('unknownModel', () => ep.client.responses.create({ ...base, model: 'askdare-spike/no-such-model' }));
    await tryIt('badKey', () =>
      new OpenAI({ apiKey: 'invalid-key-for-spike', baseURL: ep.client.baseURL, maxRetries: 0 }).responses.create(base),
    );
    await tryIt('badRequest', () =>
      ep.client.responses.create({ ...base, tool_choice: { type: 'function', name: 'not_defined' } }),
    );
    await tryIt('storeTrue', () => ep.client.responses.create({ ...base, store: true }));
    await tryIt('previousResponseId', () =>
      ep.client.responses.create({ ...base, previous_response_id: 'resp_doesnotexist' }),
    );
    await tryIt('conversation', () => ep.client.responses.create({ ...base, conversation: 'conv_doesnotexist' }));
    await tryIt('streamUnknownModel', async () => {
      const s = await ep.client.responses.create({ ...base, model: 'askdare-spike/no-such-model', stream: true });
      const types: string[] = [];
      let failure: unknown;
      for await (const e of s) {
        types.push(e.type);
        if (e.type === 'response.failed') failure = e.response.error;
        if (e.type === 'error') failure = { code: e.code, message: e.message };
      }
      return { output: types.map((type) => ({ type })), error: failure, status: 'stream' };
    });
    return out;
  },

  /** Q3: context overflow with truncation 'disabled' and 'auto' (only for 131k-context models). */
  async overflow(ep) {
    const out: Record<string, unknown> = {};
    // ~600k characters ≈ 150k tokens: over gpt-oss-120b's 131k context.
    const big = 'Brightloop board column sprint retro automation report. '.repeat(11_000);
    for (const truncation of ['disabled', 'auto'] as const) {
      try {
        const r = await ep.client.responses.create({
          model: ep.model,
          input: [{ role: 'user', content: `${big}\nSay OK.` }],
          truncation,
          store: false,
          max_output_tokens: 50,
        });
        const u = r.usage as (typeof r.usage & { cost?: number }) | undefined;
        if (u) charge(ep, { ...ZERO, inputTokens: u.input_tokens, outputTokens: u.output_tokens, reportedCostUsd: u.cost ?? 0 });
        out[truncation] = { accepted: true, inputTokens: u?.input_tokens, status: r.status };
      } catch (error) {
        out[truncation] = { accepted: false, error: errorInfo(error) };
      }
    }
    return out;
  },

  /** Q4: 20 turns (S6a's script) replayed statelessly: caching, latency, cost. */
  async conversation(ep) {
    const questions = [
      'Hi!',
      'What plans do you have?',
      'How much is the Business plan per month?',
      'And how much is that in PLN?',
      'What time is it in Warsaw right now?',
      'Is support open now?',
      'How can I reach support?',
      'Where is our data stored?',
      'Is Brightloop GDPR compliant?',
      'Do you offer SSO?',
      'Which plan has SSO?',
      'Can I try it for free?',
      'How many users can the Starter plan have?',
      'Do you have an API?',
      'What happens to my data if I cancel?',
      'Do you encrypt data at rest?',
      'Can I pay yearly?',
      'Is there a discount for nonprofits?',
      'Thanks, which plan would you recommend for a team of 12?',
      'Great, bye!',
    ];
    const history: ResponseInputItem[] = [];
    const turns = [];
    let total = ZERO;
    const errors: unknown[] = [];
    for (const [i, text] of questions.entries()) {
      const { emit } = collect();
      try {
        const turn = await runTurn({
          endpoint: ep,
          bot: BOT,
          history,
          text,
          identity: 'Alex',
          messageId: `m${i}`,
          emit,
          onStep: (s) => charge(ep, s.outcome.usage),
        });
        total = add(total, turn.usage);
        turns.push({
          turn: i + 1,
          reason: turn.reason,
          steps: turn.steps.length,
          tools: turn.steps.flatMap((s) => s.outcome.functionCalls.map((c) => c.name)),
          firstTextMs: round(turn.steps.find((s) => s.timing.firstTextMs !== undefined)?.timing.firstTextMs),
          usage: turn.usage,
          perStepCached: turn.steps.map((s) => `${s.outcome.usage.cachedInputTokens}/${s.outcome.usage.inputTokens}`),
          cacheHitRatio: Number((turn.usage.cachedInputTokens / Math.max(1, turn.usage.inputTokens)).toFixed(3)),
          replies: turn.replies?.length ?? 0,
          historyItems: history.length,
          usd: Number(usd(turn.usage, ep.price).toFixed(5)),
          listUsd: Number(listUsd(turn.usage, ep.price).toFixed(5)),
          answer: turn.text.slice(0, 160),
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Budget')) throw error;
        errors.push({ turn: i + 1, error: errorInfo(error) });
      }
    }
    mkdirSync('fixtures', { recursive: true });
    writeFileSync(
      `fixtures/${ep.name}-conversation-history.json`,
      JSON.stringify(history, (k, v: unknown) => (['encrypted_content', 'signature'].includes(k) && typeof v === 'string' ? '<redacted>' : v), 1),
    );
    const ok = turns.length;
    return {
      turnsOk: ok,
      errors,
      turns,
      total,
      usd: Number(usd(total, ep.price).toFixed(4)),
      listUsd: Number(listUsd(total, ep.price).toFixed(4)),
      sameTokensAtTerraPrices: Number(listUsd(total, TERRA).toFixed(4)),
      perTurnUsd: Number((usd(total, ep.price) / Math.max(1, ok)).toFixed(5)),
      cacheHitRatio: Number((total.cachedInputTokens / Math.max(1, total.inputTokens)).toFixed(3)),
      medianFirstTextMs: median(turns.map((t) => t.firstTextMs ?? NaN)),
    };
  },
};

function validArgs(name: string, json: string): boolean {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (name === SUGGEST_REPLIES) return Array.isArray((parsed as { items?: unknown }).items);
    return botTools.find((t) => t.name === name)?.input.safeParse(parsed).success ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- main

const [target = 'all', ...names] = process.argv.slice(2);
const endpointNames = target === 'all' ? Object.keys(ENDPOINTS) : target.split(',');
const experimentNames = names.length > 0 ? names : Object.keys(experiments);

try {
  for (const name of endpointNames) {
    const ep = ENDPOINTS[name]?.();
    if (!ep) {
      console.log(`skip ${name}: no key or unknown endpoint`);
      continue;
    }
    for (const exp of experimentNames) {
      const run = experiments[exp];
      if (!run) throw new Error(`Unknown experiment ${exp}`);
      const before = spentUsd;
      process.stdout.write(`${name} ${exp} … `);
      let result: unknown;
      try {
        result = await run(ep);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Budget')) throw error;
        result = { failed: errorInfo(error) };
      }
      (results[name] ??= {})[exp] = result;
      writeFileSync('results.json', JSON.stringify(results, null, 1));
      console.log(`${(spentUsd - before).toFixed(4)} USD`);
    }
  }
} finally {
  console.log(`spent this run: ${spentUsd.toFixed(4)} USD`);
}
