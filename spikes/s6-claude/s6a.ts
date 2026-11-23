// Spike S6a: askdare turns on Claude. `pnpm start [experiment…]` runs all experiments or the named
// ones; results go to results.json (merged), redacted streams to fixtures/.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import Anthropic from '@anthropic-ai/sdk';
import {
  add,
  botTools,
  CitationRegistry,
  INSTRUCTIONS,
  jsonSchema,
  MODEL,
  OPENAI_PRICE,
  type ProtocolEvent,
  runStep,
  runTurn,
  type StepOutcome,
  type TokenUsage,
  tokenUsage,
  tools,
  usd,
  ZERO,
} from './claude-turn.ts';

const BUDGET_USD = 4.5;
const LAST_STEP_NOTE =
  'Tools are unavailable for the rest of this answer. Reply in plain text only, from what you already know or found; say what you could not check.';
const client = new Anthropic({ maxRetries: 1 });
const results: Record<string, unknown> = existsSync('results.json')
  ? (JSON.parse(readFileSync('results.json', 'utf8')) as Record<string, unknown>)
  : {};
let spent: TokenUsage = ZERO;
const createdFiles: string[] = [];
const USER_ID = 'a3f1c9e07b5d42e8'; // what askdare would send: an HMAC pseudonym, never PII

function charge(u: TokenUsage): void {
  spent = add(spent, u);
  if (usd(spent) > BUDGET_USD) throw new Error(`Budget: ${usd(spent).toFixed(3)} USD spent`);
}

const round = (n: number | undefined): number | undefined => (n === undefined ? undefined : Math.round(n));
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** Raw stream events with thinking signatures and request IDs replaced. */
function fixture(name: string, steps: StepOutcome[]): void {
  mkdirSync('fixtures', { recursive: true });
  const redacted = JSON.stringify(
    steps.map((s) => s.rawEvents),
    (key, value: unknown) => (key === 'signature' && typeof value === 'string' ? '<redacted>' : value),
    1,
  );
  writeFileSync(`fixtures/${name}.json`, redacted);
}

function errorInfo(error: unknown): Record<string, unknown> {
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { type?: string; message?: string; details?: unknown } } | undefined;
    return {
      class: error.constructor.name,
      status: error.status,
      type: body?.error?.type,
      message: body?.error?.message,
      details: body?.error?.details,
    };
  }
  return { class: (error as Error).constructor?.name, message: (error as Error).message };
}

const bot = (over: Partial<Parameters<typeof runTurn>[0]['bot']> = {}) => ({
  suggest: true,
  knowledge: true,
  keepLengths: false,
  maxSteps: 5,
  effort: 'low' as const,
  ...over,
});

function collect(): { events: ProtocolEvent[]; emit: (e: ProtocolEvent) => void } {
  const events: ProtocolEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

/** Protocol events with consecutive text deltas joined, for the results file. */
function summarize(events: ProtocolEvent[]): unknown[] {
  const out: unknown[] = [];
  for (const e of events) {
    const prev = out.at(-1) as { type?: string; delta?: string } | undefined;
    if (e.type === 'text.delta' && prev?.type === 'text.delta') prev.delta += e.delta;
    else out.push({ ...e, messageId: undefined });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------

const experiments: Record<string, () => Promise<unknown>> = {
  /** Q1: time to first token at low effort (display omitted), minimal and full bot, 5 runs each. */
  async ttft() {
    const out: Record<string, unknown> = {};
    for (const variant of ['minimal', 'full-bot-low', 'full-bot-medium'] as const) {
      const runs = [];
      const n = variant === 'full-bot-medium' ? 3 : 5;
      for (let i = 0; i < n; i += 1) {
        const { events, emit } = collect();
        const full = variant !== 'minimal';
        const s = await runStep({
          client,
          system: [{ type: 'text', text: INSTRUCTIONS }],
          tools: full ? tools({ suggest: true, knowledge: true, keepLengths: false }) : [],
          messages: [{ role: 'user', content: full ? 'Hi! Who are you, in one sentence?' : 'Say hello in one short sentence.' }],
          toolChoice: { type: 'auto' },
          effort: variant === 'full-bot-medium' ? 'medium' : 'low',
          maxTokens: 2000,
          userId: USER_ID,
          messageId: 'm1',
          emit,
          citations: new CitationRegistry(),
        });
        charge(s.usage);
        if (i === 0 && variant === 'full-bot-low') fixture('ttft-full-bot', [s]);
        runs.push({
          firstEventMs: round(s.timing.firstEvent),
          firstThinkingMs: round(s.timing.firstThinking),
          firstTextMs: round(s.timing.firstText),
          totalMs: round(s.timing.total),
          stop: s.stopReason,
          blocks: s.message.content.map((b) => b.type),
          usage: s.usage,
          events: i === 0 ? summarize(events) : undefined,
        });
      }
      out[variant] = {
        medianFirstTextMs: median(runs.map((r) => r.firstTextMs ?? NaN)),
        runs,
      };
    }
    return out;
  },

  /** Q2: parallel calls, one failing; every result in one message; replies; the full protocol. */
  async tools() {
    const history: Anthropic.MessageParam[] = [];
    const { events, emit } = collect();
    const turn = await runTurn({
      client,
      bot: bot({ knowledge: false }),
      history,
      text: 'What time is it now in Warsaw and in Tokyo, and how much is 100 EUR in PLN?',
      userId: USER_ID,
      messageId: 'm1',
      emit,
    });
    charge(turn.usage);
    fixture('tools-parallel', turn.steps);
    return {
      reason: turn.reason,
      steps: turn.steps.map((s) => ({
        stop: s.stopReason,
        blocks: s.message.content.map((b) => (b.type === 'tool_use' ? `tool_use:${b.name}` : b.type)),
        usage: s.usage,
        firstTextMs: round(s.timing.firstText),
      })),
      historyShape: history.map((m) =>
        typeof m.content === 'string'
          ? m.role
          : `${m.role}[${m.content.map((b) => (b.type === 'tool_result' ? `tool_result${b.is_error ? '(error)' : ''}` : b.type)).join(',')}]`,
      ),
      replies: turn.replies,
      text: turn.text,
      protocol: summarize(events),
    };
  },

  /** Q2: forced final step with tool_choice none; forced any/tool; tool_choice change and the cache. */
  async finalStep() {
    const out: Record<string, unknown> = {};
    const history: Anthropic.MessageParam[] = [];
    const { emit } = collect();
    const turn = await runTurn({
      client,
      bot: bot({ knowledge: false }),
      history,
      text: 'What time is it now in Warsaw?',
      userId: USER_ID,
      messageId: 'm1',
      emit,
      forceLastStep: true,
    });
    charge(turn.usage);
    out['none'] = {
      reason: turn.reason,
      steps: turn.steps.map((s) => ({ stop: s.stopReason, blocks: s.message.content.map((b) => b.type) })),
      text: turn.text,
    };
    for (const choice of [{ type: 'any' }, { type: 'tool', name: 'get_current_time' }] as const) {
      try {
        const m = await client.messages.create({
          model: MODEL,
          max_tokens: 500,
          tools: tools(bot()),
          tool_choice: choice,
          messages: [{ role: 'user', content: 'Time in Warsaw?' }],
        });
        charge(tokenUsage(m.usage));
        out[choice.type] = { accepted: true, stop: m.stop_reason };
      } catch (error) {
        out[choice.type] = errorInfo(error);
      }
    }
    // Same prefix twice, the second with tool_choice none: does the messages cache survive?
    const long = 'Background for this chat: '.concat('Brightloop helps teams plan sprints. '.repeat(250));
    const base = {
      model: MODEL,
      max_tokens: 300,
      system: [{ type: 'text' as const, text: INSTRUCTIONS }],
      tools: tools(bot()),
      cache_control: { type: 'ephemeral' as const },
      output_config: { effort: 'low' as const },
      messages: [
        { role: 'user' as const, content: long },
        { role: 'assistant' as const, content: 'Thanks, noted.' },
        { role: 'user' as const, content: 'Say OK.' },
      ],
    };
    const cacheProbe = [];
    for (const choice of [{ type: 'auto' }, { type: 'auto' }, { type: 'none' }] as const) {
      const m = await client.messages.create({ ...base, tool_choice: choice });
      const u = tokenUsage(m.usage);
      charge(u);
      cacheProbe.push({ toolChoice: choice.type, cachedInputTokens: u.cachedInputTokens, cacheWriteTokens: u.cacheWriteTokens, inputTokens: u.inputTokens });
    }
    out['cacheAcrossToolChoice'] = cacheProbe;
    return out;
  },

  /** ADR-0015 on Claude: where the answer goes when suggest_replies is called after it. */
  async replies() {
    const variants = {
      after: {},
      afterUpdates: { thinkingDisplay: 'updates' as const },
      first: { suggestFirst: true },
    };
    const questions = ['What does the Business plan cost and include?', 'Can I get a discount?', 'How do I contact support?'];
    const out: Record<string, unknown> = {};
    for (const [name, over] of Object.entries(variants)) {
      const runs = [];
      for (const q of questions) {
        const { events, emit } = collect();
        const turn = await runTurn({ client, bot: bot(over), history: [], text: q, userId: USER_ID, messageId: 'm', emit, maxTokens: 3000 });
        charge(turn.usage);
        runs.push({
          q,
          reason: turn.reason,
          steps: turn.steps.map((s) => ({
            stop: s.stopReason,
            blocks: s.message.content.map((b) =>
              b.type === 'tool_use' ? `tool_use:${b.name}` : b.type === 'thinking' ? `thinking(${b.thinking.length} chars)` : b.type,
            ),
            outputTokens: s.usage.outputTokens,
            firstTextMs: round(s.timing.firstText),
          })),
          visibleTextChars: turn.text.length,
        turnFirstTextMs: round(turn.firstTextMs),
          replies: turn.replies,
          citations: events.filter((e) => e.type === 'citation').length,
          updates: turn.steps.flatMap((s) =>
            s.message.content.flatMap((b) => (b.type === 'thinking' && b.thinking ? [b.thinking.slice(0, 200)] : [])),
          ),
          usd: Number(usd(turn.usage).toFixed(5)),
        });
      }
      out[name] = runs;
    }
    return out;
  },

  /** Turn-level time to first visible text with suggest_replies first (knowledge questions). */
  async repliesTiming() {
    const runs = [];
    for (const q of ['What does the Business plan cost and include?', 'Can I get a discount?', 'How do I contact support?', 'Where is our data stored?']) {
      const { emit } = collect();
      const turn = await runTurn({ client, bot: bot({ suggestFirst: true }), history: [], text: q, userId: USER_ID, messageId: 'm', emit, maxTokens: 3000, lastStepNote: LAST_STEP_NOTE });
      charge(turn.usage);
      runs.push({
        q,
        turnFirstTextMs: round(turn.firstTextMs),
        stepTotalsMs: turn.steps.map((s) => round(s.timing.total)),
        steps: turn.steps.map((s) => s.message.content.map((b) => (b.type === 'tool_use' ? `tool_use:${b.name}` : b.type)).join('+')),
        textChars: turn.text.length,
        replies: turn.replies?.length ?? 0,
      });
    }
    return { medianTurnFirstTextMs: median(runs.map((r) => r.turnFirstTextMs ?? NaN)), runs };
  },

  /** Q2: the last step with tool_choice none, realistic (after tool results) and forced at step 1. */
  async finalStep2() {
    const out: Record<string, unknown> = {};
    const q = 'What time is it now in Warsaw, and how much is 100 EUR in PLN?';
    const note =
      'Tools are unavailable for the rest of this answer. Reply in plain text only, from what you already know or found; say what you could not check.';
    const cases = {
      afterToolResults: { bot: bot({ knowledge: false, maxSteps: 2 }) },
      forcedNoNote: { bot: bot({ knowledge: false }), forceLastStep: true },
      forcedWithNote: { bot: bot({ knowledge: false }), forceLastStep: true, lastStepNote: note },
      afterToolResultsWithNote: { bot: bot({ knowledge: false, maxSteps: 2 }), lastStepNote: note },
    };
    for (const [name, c] of Object.entries(cases)) {
      const runs = [];
      for (let i = 0; i < 2; i += 1) {
        const { emit } = collect();
        const turn = await runTurn({ client, history: [], text: q, userId: USER_ID, messageId: 'm', emit, maxTokens: 1200, ...c });
        charge(turn.usage);
        runs.push({
          reason: turn.reason,
          steps: turn.steps.map((s) => ({
            stop: s.stopReason,
            blocks: s.message.content.map((b) => (b.type === 'tool_use' ? `tool_use:${b.name}` : b.type)),
            out: s.usage.outputTokens,
            cached: s.usage.cachedInputTokens,
          })),
          leakedMarkup: /<invoke|<parameter|function_calls/.test(turn.text),
          text: turn.text.slice(0, 300),
        });
      }
      out[name] = runs;
    }
    return out;
  },

  /** Q2: strict tools from zod, with and without minLength/maxLength. */
  async strict() {
    const out: Record<string, unknown> = {
      schema: jsonSchema(botTools[1]!.input, true),
    };
    for (const keepLengths of [true, false]) {
      try {
        const m = await client.messages.create({
          model: MODEL,
          max_tokens: 1000,
          tools: tools({ suggest: true, knowledge: false, keepLengths }),
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: 'Convert 10 euro to złoty, please.' }],
        });
        charge(tokenUsage(m.usage));
        out[keepLengths ? 'withLengths' : 'withoutLengths'] = {
          accepted: true,
          calls: m.content.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: b.input })),
        };
      } catch (error) {
        out[keepLengths ? 'withLengths' : 'withoutLengths'] = errorInfo(error);
      }
    }
    return out;
  },

  /** Q4 (in scope part): stub retriever -> search_result blocks -> citations -> protocol; then a 2nd turn. */
  async knowledge() {
    const history: Anthropic.MessageParam[] = [];
    const out: Record<string, unknown>[] = [];
    for (const [i, text] of [
      'What does the Business plan include, and what are your support hours?',
      'And where is our data stored?',
    ].entries()) {
      const { events, emit } = collect();
      const turn = await runTurn({ client, bot: bot(), history, text, userId: USER_ID, messageId: `m${i}`, emit });
      charge(turn.usage);
      if (i === 0) fixture('knowledge-citations', turn.steps);
      const last = turn.steps.at(-1)!.message;
      out.push({
        reason: turn.reason,
        steps: turn.steps.map((s) => ({
          stop: s.stopReason,
          blocks: s.message.content.map((b) => (b.type === 'tool_use' ? `tool_use:${b.name}` : b.type)),
          usage: s.usage,
        })),
        rawCitations: last.content
          .filter((b) => b.type === 'text' && b.citations?.length)
          .flatMap((b) => (b.type === 'text' ? (b.citations ?? []) : []))
          .map((c) => ({ ...c, cited_text: `${(c as { cited_text: string }).cited_text.slice(0, 60)}…` })),
        replies: turn.replies,
        protocol: summarize(events),
      });
    }
    return out;
  },

  /** Q3 + Q5: a 20-turn conversation with identity after the cached prefix: cache hits, size, cost. */
  async conversation() {
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
    const history: Anthropic.MessageParam[] = [];
    const turns = [];
    let total = ZERO;
    for (const [i, text] of questions.entries()) {
      const { emit } = collect();
      const turn = await runTurn({
        client,
        bot: bot({ suggestFirst: true }),
        history,
        text,
        identity: 'Alex',
        lastStepNote: LAST_STEP_NOTE,
        userId: USER_ID,
        messageId: `m${i}`,
        emit,
      });
      charge(turn.usage);
      total = add(total, turn.usage);
      turns.push({
        turn: i + 1,
        steps: turn.steps.length,
        tools: turn.steps.flatMap((s) => s.calls.map((c) => c.name)),
        firstTextMs: round(turn.steps.find((s) => s.timing.firstText !== undefined)?.timing.firstText),
        turnFirstTextMs: round(turn.firstTextMs),
        usage: turn.usage,
        cacheHitRatio: Number((turn.usage.cachedInputTokens / turn.usage.inputTokens).toFixed(3)),
        historyMessages: history.length,
        historyBytes: JSON.stringify(history).length,
        usd: Number(usd(turn.usage).toFixed(5)),
      });
    }
    writeFileSync('fixtures/conversation-history.json', JSON.stringify(history, (k, v: unknown) => (k === 'signature' ? '<redacted>' : v), 1));
    return {
      turns,
      total,
      usd: Number(usd(total).toFixed(4)),
      sameTokensAtGpt61TerraPrices: Number(usd(total, OPENAI_PRICE).toFixed(4)),
      cacheHitRatio: Number((total.cachedInputTokens / total.inputTokens).toFixed(3)),
    };
  },

  /** Q3: message threads vs. stateless replay on a long conversation (~40k tokens), TTFT. */
  async threads() {
    const filler = (i: number): string =>
      `Note ${i}: ` + 'Brightloop roadmap, sprint retros, board columns, automation rules and reporting. '.repeat(70);
    const longHistory: Anthropic.MessageParam[] = [];
    for (let i = 0; i < 30; i += 1) {
      longHistory.push({ role: 'user', content: filler(i) });
      longHistory.push({ role: 'assistant', content: `Got it, note ${i} saved.` });
    }
    const questions = ['How many notes so far?', 'Say OK.', 'Name one topic.', 'Say OK again.', 'Thanks.'];
    const common = {
      model: MODEL,
      max_tokens: 300,
      output_config: { effort: 'low' as const },
      cache_control: { type: 'ephemeral' as const },
    };
    const system = [{ type: 'text' as const, text: INSTRUCTIONS }];
    const time = async (make: () => ReturnType<typeof client.beta.messages.stream>) => {
      const started = performance.now();
      const stream = make();
      let first: number | undefined;
      for await (const e of stream) if (first === undefined && e.type === 'content_block_delta' && e.delta.type === 'text_delta') first = performance.now() - started;
      const m = await stream.finalMessage();
      const u = tokenUsage(m.usage as Anthropic.Usage);
      charge(u);
      return { m, firstTextMs: round(first), total: round(performance.now() - started), usage: u };
    };
    // Stateless: replay everything every turn (warm the cache first, as a live chat would have).
    const stateless = [];
    const h1: Anthropic.Beta.BetaMessageParam[] = [...longHistory];
    h1.push({ role: 'user', content: 'Warm-up: say OK.' });
    const warm = await time(() => client.beta.messages.stream({ ...common, system, messages: h1 }));
    h1.push({ role: 'assistant', content: warm.m.content });
    for (const q of questions) {
      h1.push({ role: 'user', content: q });
      const r = await time(() => client.beta.messages.stream({ ...common, system, messages: h1 }));
      h1.push({ role: 'assistant', content: r.m.content });
      stateless.push({ firstTextMs: r.firstTextMs, total: r.total, usage: r.usage, requestBytes: JSON.stringify(h1).length });
    }
    // Thread: create with the whole history, then send only the new message.
    const threaded = [];
    const betas = ['message-threads-2026-08-12'];
    const h2: Anthropic.Beta.BetaMessageParam[] = [...longHistory, { role: 'user', content: 'Warm-up: say OK.' }];
    let previous: string;
    try {
      const created = await time(() => client.beta.messages.stream({ ...common, betas, system, messages: h2, thread: { type: 'create' } }));
      previous = created.m.id;
      for (const q of questions) {
        const r = await time(() =>
          client.beta.messages.stream({
            ...common,
            betas,
            messages: [{ role: 'user', content: q }],
            thread: { type: 'continue', previous_message_id: previous },
          }),
        );
        previous = r.m.id;
        threaded.push({ firstTextMs: r.firstTextMs, total: r.total, usage: r.usage });
      }
    } catch (error) {
      return { stateless, threadError: errorInfo(error), threaded };
    }
    // A changed tool_choice on a continue (what the forced final step would do).
    let toolChoiceChange: unknown;
    try {
      const r = await client.beta.messages.create({
        ...common,
        betas,
        tool_choice: { type: 'none' },
        messages: [{ role: 'user', content: 'Say OK.' }],
        thread: { type: 'continue', previous_message_id: previous },
      });
      charge(tokenUsage(r.usage as Anthropic.Usage));
      toolChoiceChange = { accepted: true };
    } catch (error) {
      toolChoiceChange = errorInfo(error);
    }
    return {
      historyTokens: warm.usage.inputTokens,
      stateless,
      threaded,
      medianStatelessFirstTextMs: median(stateless.map((s) => s.firstTextMs ?? NaN)),
      medianThreadedFirstTextMs: median(threaded.map((s) => s.firstTextMs ?? NaN)),
      toolChoiceChange,
    };
  },

  /** Q7: errors, safety identifier, fallbacks, dangling tool_use; doctor-style model check. */
  async errors() {
    const out: Record<string, unknown> = {};
    const tryIt = async (name: string, run: () => Promise<unknown>) => {
      try {
        out[name] = { ok: true, result: await run() };
      } catch (error) {
        out[name] = errorInfo(error);
      }
    };
    const ping = (model = MODEL) =>
      client.messages.create({ model, max_tokens: 50, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Say OK.' }] });
    await tryIt('unknownModel', () => ping('claude-does-not-exist-1'));
    await tryIt('badKey', () =>
      new Anthropic({ apiKey: 'not-a-real-key', maxRetries: 0 }).messages.create({
        model: MODEL,
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say OK.' }],
      }),
    );
    await tryIt('modelsRetrieve', async () => {
      const m = await client.models.retrieve(MODEL);
      return { id: m.id, max_input_tokens: (m as { max_input_tokens?: number }).max_input_tokens };
    });
    await tryIt('metadataUserId', async () => {
      const m = await client.messages.create({
        model: MODEL,
        max_tokens: 50,
        metadata: { user_id: USER_ID },
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Say OK.' }],
      });
      charge(tokenUsage(m.usage));
      return { stop: m.stop_reason };
    });
    await tryIt('fallbacksDefault', async () => {
      const m = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 50,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Say OK.' }],
      });
      charge(tokenUsage(m.usage as Anthropic.Usage));
      return { stop: m.stop_reason, model: m.model, iterations: (m.usage as { iterations?: unknown }).iterations };
    });
    await tryIt('danglingToolUse', () =>
      client.messages.create({
        model: MODEL,
        max_tokens: 50,
        tools: tools(bot({ knowledge: false })),
        messages: [
          { role: 'user', content: 'Time in Warsaw?' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01Dangling', name: 'get_current_time', input: { timeZone: 'Europe/Warsaw' } }] },
          { role: 'user', content: 'Hello?' },
        ],
      }),
    );
    await tryIt('systemMessageFirst', () =>
      client.messages.create({ model: MODEL, max_tokens: 50, messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'Say OK.' }] }),
    );
    return out;
  },

  /** uploadFile: Files API image + PDF in a turn, expiry, deletion, and a turn after deletion. */
  async files() {
    const out: Record<string, unknown> = {};
    const png = makePng(64, 64);
    const pdf = makePdf('Brightloop invoice 42: total 199 EUR');
    const image = await client.files.upload({
      file: await Anthropic.toFile(png, 'square.png', { type: 'image/png' }),
      expires_in_seconds: 30 * 24 * 3600,
    });
    createdFiles.push(image.id);
    const doc = await client.files.upload({
      file: await Anthropic.toFile(pdf, 'note.pdf', { type: 'application/pdf' }),
      expires_in_seconds: 30 * 24 * 3600,
    });
    createdFiles.push(doc.id);
    out['uploaded'] = [image, doc].map((f) => ({ mime: f.mime_type, size: f.size_bytes, expires_at: (f as { expires_at?: string }).expires_at }));
    const history: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'file', file_id: image.id } },
          { type: 'document', source: { type: 'file', file_id: doc.id } },
          { type: 'text', text: 'In one sentence each: what colour is the image, and what is the invoice total?' },
        ],
      },
    ];
    const first = await client.messages.create({ model: MODEL, max_tokens: 1000, output_config: { effort: 'low' }, messages: history });
    charge(tokenUsage(first.usage));
    out['answer'] = first.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('');
    out['usage'] = tokenUsage(first.usage);
    history.push({ role: 'assistant', content: first.content });
    for (const id of [image.id, doc.id]) {
      await client.files.delete(id);
      createdFiles.splice(createdFiles.indexOf(id), 1);
    }
    history.push({ role: 'user', content: 'Thanks. Anything else on the invoice?' });
    try {
      const after = await client.messages.create({ model: MODEL, max_tokens: 300, output_config: { effort: 'low' }, messages: history });
      charge(tokenUsage(after.usage));
      out['turnAfterDelete'] = { ok: true };
    } catch (error) {
      out['turnAfterDelete'] = errorInfo(error);
    }
    return out;
  },
};

// ---------------------------------------------------------------- tiny test files

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function makePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([220, 30, 30]))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function makePdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 50 750 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

// ---------------------------------------------------------------- main

const selected = process.argv.slice(2);
const names = selected.length > 0 ? selected : Object.keys(experiments);
try {
  for (const name of names) {
    const run = experiments[name];
    if (!run) throw new Error(`Unknown experiment ${name}`);
    console.log(`> ${name}`);
    const before = usd(spent);
    try {
      results[name] = await run();
    } catch (error) {
      results[name] = { failed: errorInfo(error) };
      console.error(`  failed:`, errorInfo(error));
      if (String((error as Error).message).startsWith('Budget')) break;
    }
    console.log(`  ${(usd(spent) - before).toFixed(4)} USD (run total ${usd(spent).toFixed(4)})`);
  }
} finally {
  // Clean up whatever this run created at Anthropic.
  for (const id of createdFiles) await client.files.delete(id).catch(() => undefined);
  const prior = (results['_runs'] as unknown[] | undefined) ?? [];
  results['_runs'] = [...prior, { at: new Date().toISOString(), experiments: names, usage: spent, usd: Number(usd(spent).toFixed(4)) }];
  writeFileSync('results.json', JSON.stringify(results, null, 2));
  console.log(`Run spent ${usd(spent).toFixed(4)} USD. Files left undeleted: ${createdFiles.length}`);
}
