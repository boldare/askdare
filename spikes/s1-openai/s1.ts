/**
 * Spike S1: how the Responses + Conversations APIs behave for chatdock (ADR-0003).
 *
 *   pnpm install --ignore-workspace && pnpm start
 *
 * Reads OPENAI_API_KEY and SMOKE_MODEL (or CHATDOCK_MODEL) from ../../.env.smoke.local or the
 * starter's .env. Never prints the key.
 * Writes results.json and redacted SSE fixtures, and deletes every resource it creates.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import OpenAI, { APIError, toFile } from 'openai';
import type {
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { solidPng, textPdf } from './samples.ts';

const model = process.env['SMOKE_MODEL'] ?? process.env['CHATDOCK_MODEL'];
if (!process.env['OPENAI_API_KEY'] || !model) {
  console.error('Set OPENAI_API_KEY and SMOKE_MODEL in .env.smoke.local (see docs/live-testing.md).');
  process.exit(1);
}

// --- capture raw SSE bodies to use as MSW fixtures --------------------------------------------
const captured: { label: string; body: string }[] = [];
let captureLabel: string | undefined;
const capturingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const label = captureLabel;
  if (label && response.body && response.headers.get('content-type')?.includes('text/event-stream')) {
    const [forSdk, forFixture] = response.body.tee();
    void new Response(forFixture).text().then((body) => captured.push({ label, body }));
    return new Response(forSdk, { status: response.status, headers: response.headers });
  }
  return response;
};

const client = new OpenAI({ fetch: capturingFetch, maxRetries: 1, timeout: 90_000 });
const cleanup = { conversations: new Set<string>(), files: new Set<string>(), vectorStores: new Set<string>() };
const results: Record<string, unknown> = { model, startedAt: new Date().toISOString() };
const totals = { input: 0, cached: 0, output: 0 };
const SAFETY_ID = createHash('sha256').update('chatdock-spike-s1').digest('hex');
const BASE = {
  model,
  store: true,
  truncation: 'auto',
  max_output_tokens: 300,
  safety_identifier: SAFETY_ID,
  prompt_cache_key: 'chatdock:spike-s1',
} as const;

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof APIError) {
    return { kind: error.constructor.name, status: error.status, code: error.code, param: error.param, message: error.message };
  }
  return { kind: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : String(error) };
}

async function experiment(name: string, run: () => Promise<Record<string, unknown>>): Promise<void> {
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
  readonly usage: Record<string, unknown> | undefined;
  readonly eventTypes: Record<string, number>;
  readonly outputItems: { type: string; name?: string; call_id?: string }[];
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
  const eventTypes: Record<string, number> = {};
  const outputItems: { type: string; name?: string; call_id?: string }[] = [];
  const annotations: unknown[] = [];
  let terminal: Extract<ResponseStreamEvent, { type: 'response.completed' | 'response.incomplete' }> | undefined;
  try {
    const stream = await client.responses.create({ ...params, stream: true });
    for await (const event of stream) {
      eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
      if (event.type === 'response.output_text.delta') {
        ttftMs ??= Math.round(performance.now() - started);
        text += event.delta;
      } else if (event.type === 'response.output_text.annotation.added') {
        annotations.push(event.annotation);
      } else if (event.type === 'response.output_item.done') {
        const item = event.item;
        outputItems.push(
          item.type === 'function_call' ? { type: item.type, name: item.name, call_id: item.call_id } : { type: item.type },
        );
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
    totals.output += usage.output_tokens;
  }
  return {
    text,
    ttftMs,
    totalMs: Math.round(performance.now() - started),
    status: terminal?.response.status,
    incompleteReason: terminal?.response.incomplete_details?.reason,
    usage: usage
      ? { input: usage.input_tokens, cached: usage.input_tokens_details.cached_tokens, output: usage.output_tokens }
      : undefined,
    eventTypes,
    outputItems,
    annotations,
  };
}

async function newConversation(tag: string): Promise<string> {
  const conversation = await client.conversations.create({ metadata: { chatdock_bot: 'spike', chatdock_visitor: tag } });
  cleanup.conversations.add(conversation.id);
  return conversation.id;
}

const user = (content: string): ResponseInputItem => ({ role: 'user', content });

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
} as const;

async function main(): Promise<void> {
  // E1–E3: text turns, history and items.list
  const conv1 = await newConversation('e1');
  await experiment('e1_text_turn', async () => ({
    ...(await streamTurn(
      { ...BASE, instructions: 'Be brief.', input: [user('Write one short sentence about the sea.')], conversation: conv1 },
      'text-turn',
    )),
  }));
  await experiment('e2_second_turn_with_history', async () => ({
    ...(await streamTurn({ ...BASE, instructions: 'Be brief.', input: [user('Now one about mountains.')], conversation: conv1 })),
  }));
  await experiment('e3_items_list', async () => {
    const started = performance.now();
    const asc = await client.conversations.items.list(conv1, { order: 'asc', limit: 100 });
    const listMs = Math.round(performance.now() - started);
    const desc = await client.conversations.items.list(conv1);
    return {
      listMs,
      count: asc.data.length,
      hasMore: asc.has_more,
      itemsAsc: asc.data.map((item) => ({ type: item.type, role: 'role' in item ? item.role : undefined })),
      defaultOrderFirstRole: (() => {
        const first = desc.data[0];
        return first && 'role' in first ? first.role : first?.type;
      })(),
    };
  });

  // E4: function calling loop inside a conversation
  const conv2 = await newConversation('e4');
  await experiment('e4_function_call_loop', async () => {
    const first = await streamTurn(
      {
        ...BASE,
        instructions: 'Use tools when relevant.',
        input: [user('What is the weather in Warsaw? Use the tool.')],
        conversation: conv2,
        tools: [WEATHER_TOOL],
      },
      'function-call',
    );
    const call = first.outputItems.find((item) => item.type === 'function_call');
    if (!call?.call_id) return { first, note: 'model did not call the tool' };
    const second = await streamTurn({
      ...BASE,
      instructions: 'Use tools when relevant.',
      input: [{ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ tempC: 12, sky: 'cloudy' }) }],
      conversation: conv2,
      tools: [WEATHER_TOOL],
    });
    return { first, second, answerMentions12: second.text.includes('12') };
  });

  // E5: dangling function call, then repair with a synthetic output
  const conv3 = await newConversation('e5');
  await experiment('e5_dangling_call_and_repair', async () => {
    const first = await streamTurn({
      ...BASE,
      instructions: 'Use tools when relevant.',
      input: [user('What is the weather in Krakow? Use the tool.')],
      conversation: conv3,
      tools: [WEATHER_TOOL],
    });
    const call = first.outputItems.find((item) => item.type === 'function_call');
    if (!call?.call_id) return { note: 'model did not call the tool' };
    let withoutRepair: unknown;
    try {
      withoutRepair = { ok: true, ...(await streamTurn({ ...BASE, input: [user('Never mind, just say hi.')], conversation: conv3, tools: [WEATHER_TOOL] })) };
    } catch (error) {
      withoutRepair = { ok: false, error: describeError(error) };
    }
    let withRepair: unknown;
    try {
      withRepair = {
        ok: true,
        ...(await streamTurn({
          ...BASE,
          input: [
            { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: 'Tool unavailable.' }) },
            user('Never mind, just say hi.'),
          ],
          conversation: conv3,
          tools: [WEATHER_TOOL],
        })),
      };
    } catch (error) {
      withRepair = { ok: false, error: describeError(error) };
    }
    return { withoutRepair, withRepair };
  });

  // E6: file_search with citations
  await experiment('e6_file_search_citations', async () => {
    const store = await client.vectorStores.create({
      name: 'chatdock-spike-s1',
      expires_after: { anchor: 'last_active_at', days: 1 },
    });
    cleanup.vectorStores.add(store.id);
    const handbook = await toFile(
      Buffer.from('# Team handbook\n\nThe office dog is called Pixel. Pixel visits on Fridays.\n'),
      'chatdock-handbook.md',
    );
    const uploaded = await client.vectorStores.files.uploadAndPoll(store.id, handbook);
    cleanup.files.add(uploaded.id);
    const conv = await newConversation('e6');
    const turn = await streamTurn(
      {
        ...BASE,
        instructions: 'Answer from the provided files and cite them.',
        input: [user('What is the office dog called?')],
        conversation: conv,
        tools: [{ type: 'file_search', vector_store_ids: [store.id], max_num_results: 3 }],
        include: ['file_search_call.results'],
      },
      'file-search',
    );
    return { fileStatus: uploaded.status, ...turn };
  });

  // E7–E9: images and PDFs as file inputs, then a turn after the file is deleted
  let visionConversation: string | undefined;
  let visionFileId: string | undefined;
  for (const purpose of ['vision', 'user_data'] as const) {
    await experiment(`e7_image_purpose_${purpose}`, async () => {
      const file = await client.files.create({
        file: await toFile(solidPng(64, 64, [220, 20, 20]), 'red-square.png', { type: 'image/png' }),
        purpose,
        expires_after: { anchor: 'created_at', seconds: 3600 },
      });
      cleanup.files.add(file.id);
      const conv = await newConversation(`e7-${purpose}`);
      const turn = await streamTurn({
        ...BASE,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'What colour is this image? One word.' },
              { type: 'input_image', file_id: file.id, detail: 'low' },
            ],
          },
        ],
        conversation: conv,
      });
      if (purpose === 'vision') {
        visionConversation = conv;
        visionFileId = file.id;
      }
      return { saysRed: /red/i.test(turn.text), ...turn };
    });
  }
  await experiment('e8_pdf_user_data', async () => {
    const file = await client.files.create({
      file: await toFile(textPdf('The secret word is papaya.'), 'secret.pdf', { type: 'application/pdf' }),
      purpose: 'user_data',
      expires_after: { anchor: 'created_at', seconds: 3600 },
    });
    cleanup.files.add(file.id);
    const conv = await newConversation('e8');
    const turn = await streamTurn({
      ...BASE,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is the secret word in the PDF? One word.' },
            { type: 'input_file', file_id: file.id },
          ],
        },
      ],
      conversation: conv,
    });
    return { saysPapaya: /papaya/i.test(turn.text), ...turn };
  });
  await experiment('e9_turn_after_file_deleted', async () => {
    if (!visionConversation || !visionFileId) return { note: 'no vision conversation from e7' };
    await client.files.delete(visionFileId);
    cleanup.files.delete(visionFileId);
    return { ...(await streamTurn({ ...BASE, input: [user('And what shape was it?')], conversation: visionConversation })) };
  });

  // E10: store:false together with a conversation
  await experiment('e10_store_false_with_conversation', async () => {
    const conv = await newConversation('e10');
    await streamTurn({ ...BASE, input: [user('Say "one".')], conversation: conv });
    const before = (await client.conversations.items.list(conv, { limit: 100 })).data.length;
    let turn: unknown;
    try {
      turn = { ok: true, ...(await streamTurn({ ...BASE, store: false, input: [user('Say "two".')], conversation: conv })) };
    } catch (error) {
      turn = { ok: false, error: describeError(error) };
    }
    const after = (await client.conversations.items.list(conv, { limit: 100 })).data.length;
    return { itemsBefore: before, itemsAfter: after, turn };
  });

  // E11: a deleted conversation (retention) — what error do we get?
  await experiment('e11_deleted_conversation', async () => {
    const conv = await newConversation('e11');
    await client.conversations.delete(conv);
    cleanup.conversations.delete(conv);
    try {
      await streamTurn({ ...BASE, input: [user('Hello?')], conversation: conv });
      return { note: 'unexpectedly succeeded' };
    } catch (error) {
      return { error: describeError(error) };
    }
  });

  // E12: reasoning items (only for models that accept a reasoning effort)
  await experiment('e12_reasoning_status', async () => {
    const conv = await newConversation('e12');
    return {
      ...(await streamTurn({
        ...BASE,
        input: [user('Is 391 a prime number? Answer yes or no.')],
        conversation: conv,
        reasoning: { effort: 'low' },
      })),
    };
  });

  // E13: invalid parameter → error shape our mapping relies on
  await experiment('e13_invalid_model_error', async () => {
    try {
      await streamTurn({ ...BASE, model: 'chatdock-no-such-model', input: [user('Hi')] });
      return { note: 'unexpectedly succeeded' };
    } catch (error) {
      return { error: describeError(error) };
    }
  });
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
  results['cleanup'] = cleanupReport;
  results['tokens'] = totals;
  results['finishedAt'] = new Date().toISOString();
  await mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
  for (const { label, body } of captured) {
    await writeFile(new URL(`./fixtures/${label}.sse`, import.meta.url), body);
  }
  await writeFile(new URL('./results.json', import.meta.url), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nTokens: ${JSON.stringify(totals)}. Results in spikes/s1-openai/results.json`);
}
