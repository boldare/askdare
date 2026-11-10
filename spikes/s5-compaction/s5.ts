/**
 * Spike S5: does server-side compaction (`context_management`) work with the Conversations API
 * the way askdare uses it (ADR-0003)?
 *
 *   pnpm install --ignore-workspace && pnpm start
 *
 * Reads OPENAI_API_KEY and SMOKE_MODEL (or ASKDARE_MODEL) from ../../.env.smoke.local or the
 * starter's .env.local. Never prints the key.
 * Writes results.json and redacted fixtures, and deletes every resource it creates.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import OpenAI, { APIError, toFile } from 'openai';
import type {
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
  Tool,
} from 'openai/resources/responses/responses';

const model = process.env['SMOKE_MODEL'] ?? process.env['ASKDARE_MODEL'];
if (!process.env['OPENAI_API_KEY'] || !model) {
  console.error('Set OPENAI_API_KEY and SMOKE_MODEL in .env.smoke.local (see docs/live-testing.md).');
  process.exit(1);
}

// Worst case for gpt-6.1-terra (every input token billed as a 30-minute cache write), per 1M tokens.
const PRICE = { input: 1.25, output: 5 };
// The first full run lost its report (see README), so this run is kept smaller.
const BUDGET_USD = 0.045;

// --- capture raw bodies to use as MSW fixtures ------------------------------------------------
const captured: { label: string; body: string; kind: 'sse' | 'json' }[] = [];
let captureLabel: string | undefined;
const capturingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const label = captureLabel;
  const type = response.headers.get('content-type') ?? '';
  if (label && response.body && (type.includes('text/event-stream') || type.includes('json'))) {
    const kind = type.includes('text/event-stream') ? 'sse' : 'json';
    const [forSdk, forFixture] = response.body.tee();
    void new Response(forFixture).text().then((body) => captured.push({ label, body, kind }));
    return new Response(forSdk, { status: response.status, headers: response.headers });
  }
  return response;
};

const client = new OpenAI({ fetch: capturingFetch, maxRetries: 1, timeout: 120_000 });
const cleanup = { conversations: new Set<string>(), files: new Set<string>(), vectorStores: new Set<string>() };
const results: Record<string, unknown> = { model, sdk: '7.52.0', startedAt: new Date().toISOString() };
const totals = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 };
const SAFETY_ID = createHash('sha256').update('askdare-spike-s5').digest('hex');
// Mirrors packages/askdare/src/openai/turn.ts (runStep).
const BASE = {
  model,
  store: true,
  truncation: 'auto',
  max_output_tokens: 400,
  safety_identifier: SAFETY_ID,
  prompt_cache_key: 'askdare:spike-s5',
} as const;

const spentUsd = (): number => (totals.input * PRICE.input + totals.output * PRICE.output) / 1_000_000;
const compaction = (threshold: number) => [{ type: 'compaction', compact_threshold: threshold }];

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof APIError) {
    return { kind: error.constructor.name, status: error.status, code: error.code, param: error.param, message: error.message };
  }
  return { kind: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : String(error) };
}

async function experiment(name: string, run: () => Promise<Record<string, unknown>>): Promise<void> {
  if (spentUsd() > BUDGET_USD) {
    results[name] = { ok: false, skipped: `budget: ${spentUsd().toFixed(4)} USD spent` };
    console.log(`- ${name}: skipped (budget)`);
    return;
  }
  const started = performance.now();
  try {
    const outcome = await run();
    results[name] = { ok: true, ms: Math.round(performance.now() - started), ...outcome };
    console.log(`✓ ${name}`);
  } catch (error) {
    results[name] = { ok: false, ms: Math.round(performance.now() - started), error: describeError(error) };
    console.log(`✗ ${name}: ${describeError(error)['message']}`);
  }
}

interface TurnResult {
  readonly text: string;
  readonly ttftMs: number | undefined;
  readonly totalMs: number;
  readonly status: string | undefined;
  readonly incompleteReason: string | undefined;
  readonly usage: Record<string, number> | undefined;
  /** `usage` exactly as the API reported it, to spot fields our mapper doesn't read yet. */
  readonly rawUsage: unknown;
  /** Event types in arrival order, consecutive repeats collapsed (`type ×n`). */
  readonly sequence: string[];
  readonly outputItems: { index: number; type: string; name?: string; call_id?: string }[];
  readonly compacted: boolean;
  readonly compaction:
    | { outputIndex: number; idPrefix: string; createdBy: unknown; encryptedChars: number; ms: number | undefined }
    | undefined;
  readonly finalOutputTypes: string[];
  readonly annotations: unknown[];
}

async function streamTurn(
  params: Omit<ResponseCreateParamsStreaming, 'stream'>,
  label?: string,
): Promise<TurnResult> {
  captureLabel = label;
  const started = performance.now();
  let ttftMs: number | undefined;
  let text = '';
  const sequence: string[] = [];
  let last = '';
  let repeats = 0;
  const outputItems: TurnResult['outputItems'] = [];
  const annotations: unknown[] = [];
  let compactionStarted: number | undefined;
  let compactionInfo: TurnResult['compaction'];
  let terminal: Extract<ResponseStreamEvent, { type: 'response.completed' | 'response.incomplete' }> | undefined;
  const push = (type: string) => {
    if (type === last) {
      repeats += 1;
      sequence[sequence.length - 1] = `${type} ×${repeats + 1}`;
    } else {
      last = type;
      repeats = 0;
      sequence.push(type);
    }
  };
  try {
    const stream = await client.responses.create({ ...params, stream: true });
    for await (const event of stream) {
      const added = event.type === 'response.output_item.added' || event.type === 'response.output_item.done';
      push(added ? `${event.type}:${event.item.type}` : event.type);
      if (event.type === 'response.output_text.delta') {
        ttftMs ??= Math.round(performance.now() - started);
        text += event.delta;
      } else if (event.type === 'response.output_text.annotation.added') {
        annotations.push(event.annotation);
      } else if (event.type === 'response.output_item.added' && event.item.type === 'compaction') {
        compactionStarted = performance.now();
      } else if (event.type === 'response.output_item.done') {
        const item = event.item;
        outputItems.push(
          item.type === 'function_call'
            ? { index: event.output_index, type: item.type, name: item.name, call_id: item.call_id }
            : { index: event.output_index, type: item.type },
        );
        if (item.type === 'compaction') {
          compactionInfo = {
            outputIndex: event.output_index,
            idPrefix: item.id.split('_')[0] ?? '',
            createdBy: item.created_by,
            encryptedChars: item.encrypted_content.length,
            ms: compactionStarted ? Math.round(performance.now() - compactionStarted) : undefined,
          };
        }
      } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        terminal = event;
      } else if (event.type === 'response.failed') {
        throw new Error(`response.failed: ${JSON.stringify(event.response.error)}`);
      } else if (event.type === 'error') {
        throw new Error(`stream error: ${event.code} ${event.message}`);
      }
    }
  } finally {
    captureLabel = undefined;
  }
  const usage = terminal?.response.usage;
  if (usage) {
    totals.input += usage.input_tokens;
    totals.cached += usage.input_tokens_details.cached_tokens;
    totals.cacheWrite += usage.input_tokens_details.cache_write_tokens ?? 0;
    totals.output += usage.output_tokens;
    totals.reasoning += usage.output_tokens_details.reasoning_tokens;
  }
  return {
    text,
    ttftMs,
    totalMs: Math.round(performance.now() - started),
    status: terminal?.response.status,
    incompleteReason: terminal?.response.incomplete_details?.reason,
    usage: usage
      ? {
          input: usage.input_tokens,
          cached: usage.input_tokens_details.cached_tokens,
          cacheWrite: usage.input_tokens_details.cache_write_tokens ?? 0,
          output: usage.output_tokens,
          reasoning: usage.output_tokens_details.reasoning_tokens,
        }
      : undefined,
    rawUsage: usage,
    sequence,
    outputItems,
    compacted: compactionInfo !== undefined,
    compaction: compactionInfo,
    finalOutputTypes: terminal?.response.output.map((item) => item.type) ?? [],
    annotations,
  };
}

async function newConversation(tag: string): Promise<string> {
  const conversation = await client.conversations.create({
    metadata: { askdare_bot: 'spike-s5', askdare_visitor: tag },
  });
  cleanup.conversations.add(conversation.id);
  return conversation.id;
}

/** What `listHistory` (src/openai/history.ts) requests, plus an ascending read for the report. */
async function listItems(conversation: string, label?: string): Promise<Record<string, unknown>> {
  captureLabel = label;
  let desc: Awaited<ReturnType<typeof client.conversations.items.list>>;
  try {
    desc = await client.conversations.items.list(conversation, {
      order: 'desc',
      limit: 100,
      include: ['file_search_call.results'],
    });
  } finally {
    captureLabel = undefined;
  }
  const asc = desc.data.toReversed();
  const compactionIndex = asc.findIndex((item) => item.type === 'compaction');
  return {
    count: asc.length,
    hasMore: desc.has_more,
    typesAsc: asc.map((item) => (item.type === 'message' ? `message:${item.role}` : item.type)),
    compactionStored: compactionIndex >= 0,
    compactionIndex,
    messagesBeforeCompaction:
      compactionIndex >= 0 ? asc.slice(0, compactionIndex).filter((item) => item.type === 'message').length : undefined,
  };
}

const user = (content: string): ResponseInputItem => ({ role: 'user', content });

// --- synthetic filler, roughly 4 characters per token --------------------------------------------
const CITIES = ['Lisbon', 'Gdansk', 'Porto', 'Lyon', 'Bergen', 'Krakow', 'Turin', 'Ghent', 'Malmo', 'Leeds'];
const GOODS = ['blue crates', 'oak pallets', 'glass jars', 'wool rolls', 'steel pins', 'paper reams', 'clay tiles'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
function notes(seed: number, tokens: number): string {
  const lines: string[] = [];
  let index = 0;
  while (lines.join(' ').length < tokens * 4) {
    const n = seed * 97 + index * 31;
    lines.push(
      `Note ${seed}.${index + 1}: the ${CITIES[n % CITIES.length]} depot ships ${n % 90 + 10} ${GOODS[n % GOODS.length]} every ${DAYS[n % DAYS.length]}, and the driver checks the seals twice before leaving.`,
    );
    index += 1;
  }
  return lines.join('\n');
}

const WEATHER_TOOL = {
  type: 'function',
  name: 'get_weather',
  description: 'Current weather for a city.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
} as const satisfies Tool;

const CODE_WORD = 'PAPAYA-42';
const PLAIN_THRESHOLD = 1_300;
const TOOL_THRESHOLD = 1_000;
const FILLER = 500;

async function main(): Promise<void> {
  // E0: the smallest threshold the API accepts, and an empty conversation with a tiny threshold.
  await experiment('e0_threshold_floor', async () => {
    const conv = await newConversation('e0');
    const tries: Record<string, unknown> = {};
    for (const threshold of [0, 1, 100, 1_000]) {
      try {
        const turn = await streamTurn({
          ...BASE,
          max_output_tokens: 32,
          instructions: 'Be brief.',
          input: [user('Say "hi".')],
          conversation: conv,
          context_management: compaction(threshold),
        });
        tries[threshold] = { accepted: true, compacted: turn.compacted, usage: turn.usage, sequence: turn.sequence };
      } catch (error) {
        tries[threshold] = { accepted: false, error: describeError(error) };
      }
    }
    return { tries, items: await listItems(conv) };
  });

  // E1–E3: a plain chat that crosses the threshold, then recall and the stored items.
  const conv1 = await newConversation('e1');
  const turns: Record<string, unknown>[] = [];
  let compactedAt: number | undefined;
  await experiment('e1_plain_chat_until_compaction', async () => {
    for (let turn = 1; turn <= 5 && compactedAt === undefined; turn += 1) {
      const intro = turn === 1 ? `Remember this code word: ${CODE_WORD}. ` : '';
      const result = await streamTurn(
        {
          ...BASE,
          instructions: 'You are a logistics assistant. Be brief.',
          input: [user(`${intro}Here are more shipping notes.\n${notes(turn, FILLER)}\nReply with the single word "noted".`)],
          conversation: conv1,
          context_management: compaction(PLAIN_THRESHOLD),
        },
        `e1-turn-${turn}`,
      );
      turns.push({ turn, ...result, text: result.text.slice(0, 80) });
      if (result.compacted) compactedAt = turn;
    }
    return { threshold: PLAIN_THRESHOLD, compactedAt, turns };
  });
  await experiment('e2_items_after_compaction', async () => ({ ...(await listItems(conv1, 'e2-items-after-compaction')) }));
  await experiment('e3_turns_after_compaction', async () => {
    const recall = await streamTurn(
      {
        ...BASE,
        instructions: 'You are a logistics assistant. Be brief.',
        input: [user('What was the code word in my first message? Answer with the code word only.')],
        conversation: conv1,
        context_management: compaction(PLAIN_THRESHOLD),
      },
      'e3-recall',
    );
    const detail = await streamTurn(
      {
        ...BASE,
        instructions: 'You are a logistics assistant. Be brief.',
        input: [user('From my notes: in note 1.1, which city ships what, and how many? One line.')],
        conversation: conv1,
        context_management: compaction(PLAIN_THRESHOLD),
      },
      'e3-detail',
    );
    const small = await streamTurn(
      {
        ...BASE,
        instructions: 'You are a logistics assistant. Be brief.',
        input: [user('Say "ok".')],
        conversation: conv1,
        context_management: compaction(PLAIN_THRESHOLD),
      },
      'e3-small',
    );
    return {
      small,
      recall: { ...recall, remembersCodeWord: recall.text.includes(CODE_WORD) },
      detail: { ...detail, expected: notes(1, 40).split('\n')[0], remembersNote: /ghent/i.test(detail.text) && detail.text.includes('17') },
      items: await listItems(conv1, 'e3-items-after-recall'),
    };
  });

  // E4: a function tool. The turn that crosses the threshold should also call the tool.
  await experiment('e4_function_tool', async () => {
    const conv = await newConversation('e4');
    const steps: Record<string, unknown>[] = [];
    const base = {
      ...BASE,
      instructions: 'You are a logistics assistant. Use tools when relevant. Be brief.',
      conversation: conv,
      tools: [WEATHER_TOOL],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      context_management: compaction(TOOL_THRESHOLD),
    } satisfies Omit<ResponseCreateParamsStreaming, 'stream' | 'input'>;
    const first = await streamTurn(
      { ...base, input: [user(`Shipping notes:\n${notes(11, FILLER)}\nReply "noted".`)] },
      'e4-turn-1',
    );
    steps.push({ step: 'turn 1', ...first, text: first.text.slice(0, 80) });
    const ask = await streamTurn(
      { ...base, input: [user(`More notes:\n${notes(12, FILLER)}\nWhat is the weather in Warsaw? Use the tool.`)] },
      'e4-tool-call',
    );
    steps.push({ step: 'turn 2, step 1', ...ask, text: ask.text.slice(0, 80) });
    const call = ask.outputItems.find((item) => item.type === 'function_call');
    if (!call?.call_id) return { threshold: TOOL_THRESHOLD, steps, note: 'model did not call the tool' };
    const answer = await streamTurn(
      {
        ...base,
        input: [{ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ tempC: 12, sky: 'cloudy' }) }],
      },
      'e4-tool-answer',
    );
    steps.push({ step: 'turn 2, step 2', ...answer, answerMentions12: answer.text.includes('12') });
    const again = await streamTurn({ ...base, input: [user('And in Krakow? Use the tool.')] }, 'e4-turn-3');
    steps.push({ step: 'turn 3, step 1', ...again, text: again.text.slice(0, 80) });
    const call2 = again.outputItems.find((item) => item.type === 'function_call');
    if (call2?.call_id) {
      const answer2 = await streamTurn(
        {
          ...base,
          input: [{ type: 'function_call_output', call_id: call2.call_id, output: JSON.stringify({ tempC: 9, sky: 'rain' }) }],
        },
        'e4-turn-3-answer',
      );
      steps.push({ step: 'turn 3, step 2', ...answer2, answerMentions9: answer2.text.includes('9') });
    }
    return { threshold: TOOL_THRESHOLD, steps, items: await listItems(conv) };
  });

  // E5: file_search with citations across a compaction.
  await experiment('e5_file_search', async () => {
    const store = await client.vectorStores.create({
      name: 'askdare-spike-s5',
      expires_after: { anchor: 'last_active_at', days: 1 },
    });
    cleanup.vectorStores.add(store.id);
    const handbook = await toFile(
      Buffer.from(
        '# Team handbook\n\nThe office dog is called Pixel. Pixel visits on Fridays.\n\nThe coffee machine is cleaned every Wednesday by the facilities team.\n',
      ),
      'askdare-handbook.md',
    );
    const uploaded = await client.vectorStores.files.uploadAndPoll(store.id, handbook);
    cleanup.files.add(uploaded.id);
    const conv = await newConversation('e5');
    const base = {
      ...BASE,
      instructions: 'Answer from the provided files and cite them. Be brief.',
      conversation: conv,
      tools: [{ type: 'file_search', vector_store_ids: [store.id], max_num_results: 3 }],
      include: ['file_search_call.results'],
      context_management: compaction(TOOL_THRESHOLD),
    } satisfies Omit<ResponseCreateParamsStreaming, 'stream' | 'input'>;
    const steps: Record<string, unknown>[] = [];
    const questions = [
      'What is the office dog called?',
      'When is the coffee machine cleaned?',
      'On which day does the dog visit?',
    ];
    for (const [index, question] of questions.entries()) {
      const turn = await streamTurn({ ...base, input: [user(question)] }, `e5-turn-${index + 1}`);
      steps.push({ turn: index + 1, ...turn, text: turn.text.slice(0, 120) });
    }
    return { threshold: TOOL_THRESHOLD, fileStatus: uploaded.status, steps, items: await listItems(conv) };
  });
}

// --- redaction: stable fake ids, no encrypted blobs, never a key ---------------------------------
const ids = new Map<string, string>();
const counters = new Map<string, number>();
function redact(body: string): string {
  // Encrypted blobs go first: base64 can contain anything, including `sk-…` (the first run tripped on it).
  const withoutBlobs = body.replaceAll(/("encrypted_content":\s*)"[^"]*"/g, '$1"redacted"');
  if (/\bsk-[A-Za-z0-9_-]{20,}/.test(withoutBlobs)) throw new Error('A captured body contains something that looks like a key.');
  return withoutBlobs
    .replaceAll(/\b(org|proj)-[A-Za-z0-9]{8,}\b/g, '$1-redacted')
    .replaceAll(/\b([a-z]{2,6})_([A-Za-z0-9]{20,})\b/g, (match, prefix: string) => {
      const known = ids.get(match);
      if (known) return known;
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      const fake = `${prefix}_s5${String(n).padStart(4, '0')}`;
      ids.set(match, fake);
      return fake;
    })
    .replaceAll(/\bfile-[A-Za-z0-9]{10,}\b/g, 'file-s5redacted');
}

try {
  await main();
} finally {
  const cleanupReport: Record<string, unknown> = {};
  for (const id of cleanup.conversations) {
    cleanupReport[id] = await client.conversations.delete(id).then(() => 'deleted', (error: unknown) => describeError(error)['message']);
  }
  for (const id of cleanup.vectorStores) {
    cleanupReport[id] = await client.vectorStores.delete(id).then(() => 'deleted', (error: unknown) => describeError(error)['message']);
  }
  for (const id of cleanup.files) {
    cleanupReport[id] = await client.files.delete(id).then(() => 'deleted', (error: unknown) => describeError(error)['message']);
  }
  results['cleanup'] = Object.values(cleanupReport).every((outcome) => outcome === 'deleted')
    ? `${Object.keys(cleanupReport).length} of ${Object.keys(cleanupReport).length} deleted`
    : cleanupReport;
  results['tokens'] = totals;
  results['worstCaseUsd'] = Number(spentUsd().toFixed(4));
  results['finishedAt'] = new Date().toISOString();
  // Give the tee'd fixture readers a moment to finish.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await writeFile(new URL('./results.json', import.meta.url), `${redact(JSON.stringify(results, null, 2))}\n`);
  await mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
  for (const { label, body, kind } of captured) {
    try {
      await writeFile(new URL(`./fixtures/${label}.${kind}`, import.meta.url), redact(body));
    } catch (error) {
      console.log(`fixture ${label} not written: ${describeError(error)['message']}`);
    }
  }
  console.log(`\nTokens: ${JSON.stringify(totals)}, worst case ${spentUsd().toFixed(4)} USD. Results in results.json`);
}
