/**
 * Live smoke test against the real OpenAI API. Never part of `pnpm test`.
 *
 * Run with a key from a dedicated OpenAI project that has a hard spend limit:
 *   OPENAI_API_KEY=… SMOKE_MODEL=<cheap current model> pnpm smoke
 * Add SMOKE_VECTOR_STORE_ID (a store synced from site/knowledge) for the file search turns,
 * and SMOKE_AUDIO_FILE (a short recording of speech) with SMOKE_TRANSCRIBE_MODEL for dictation.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import OpenAI, { NotFoundError } from 'openai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBot } from '../bot/define-bot';
import { itemHistory } from '../conversations/history';
import { memoryConversations } from '../conversations/memory';
import { type HistoryReader, historyReader } from '../conversations/provider-history';
import { defineForm } from '../forms/define-form';
import type { TurnHandoff } from '../gateway';
import { HANDOFF_REASONS } from '../handoff/report';
import type { ProtocolEvent } from '../protocol/events';
import { streamTurn } from '../server/stream-turn';
import type { ChatUsageReport } from '../server/usage-report';
import { defineTool } from '../tools/define-tool';
import { HANDOFF } from '../tools/handoff';
import { SHOW_FORM } from '../tools/show-form';
import { readSuggestedReplies } from '../tools/suggest-replies';
import { openaiConversations } from './conversations';
import { createOpenAIGateway } from './gateway';

const apiKey = process.env['OPENAI_API_KEY'];
const conversations = openaiConversations(apiKey ? { apiKey } : {});
const readHistory = historyReader(conversations);
const readMessages: HistoryReader = (id, request) =>
  readHistory ? readHistory(id, request) : Promise.reject(new Error('No history reader.'));
const model = process.env['SMOKE_MODEL'];
const vectorStoreId = process.env['SMOKE_VECTOR_STORE_ID'];
const audioFile = process.env['SMOKE_AUDIO_FILE'];
const transcribeModel = process.env['SMOKE_TRANSCRIBE_MODEL'];

/** A solid-color PNG, built by hand so the test needs no image library. */
function solidPng(size: number, [red, green, blue]: readonly [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(size).fill([red, green, blue]).flat()),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF with one line of text, with a valid cross-reference table. */
function textPdf(text: string): Uint8Array {
  const content = `BT /F1 18 Tf 20 70 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** A fetch that keeps the body of every Responses request, to check what each step offered. */
function recordingFetch(): {
  readonly fetch: typeof fetch;
  readonly bodies: Record<string, unknown>[];
} {
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/responses') && typeof init?.body === 'string') {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return fetch(input, init);
    },
  };
}

/** The function names a request's `tool_choice` lets the model call. */
function allowedFunctions(body: Record<string, unknown> | undefined): string[] | 'all' | 'none' {
  const choice = body?.['tool_choice'];
  if (choice === 'auto' || choice === undefined) return 'all';
  if (choice === 'none') return 'none';
  return ((choice as { tools?: { type: string; name?: string }[] }).tools ?? []).flatMap((tool) =>
    tool.type === 'function' && tool.name ? [tool.name] : [],
  );
}

/** A handoff hook that records the model's calls and answers with `sent`. */
function sentHandoff(): TurnHandoff & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    offered: true,
    calls,
    run: async (call) => {
      calls.push(call.arguments);
      return { state: 'sent' };
    },
  };
}

const offerForm = defineForm({
  name: 'offer',
  description: 'Contact details for a sales offer: use it when the visitor asks for an offer.',
  title: 'Get an offer',
  fields: [
    { name: 'email', type: 'email', label: 'Email', required: true },
    {
      name: 'seats',
      type: 'select',
      label: 'Seats',
      options: [
        { value: 'small', label: '1 to 10' },
        { value: 'large', label: 'More than 10' },
      ],
    },
  ],
});
const contactForm = defineForm({
  name: 'contact',
  model: false,
  title: 'Contact',
  fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
});
const ping = defineTool({
  name: 'ping',
  description: 'Never needed.',
  input: z.object({}),
  execute: () => 'pong',
});

describe.skipIf(!apiKey || !model)('OpenAI gateway (live)', () => {
  it('runs a text turn in a new conversation and cleans up', async () => {
    const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
    const bot = createBot({
      id: 'smoke',
      model: model ?? '',
      instructions: 'Reply with exactly one word: pong.',
      limits: { maxOutputTokens: 64 },
    });
    const conversationId = await conversations.create({ botId: bot.id, owner: 'visitor:smoke' });
    try {
      const events: ProtocolEvent[] = [];
      const result = await gateway.runTurn({
        bot,
        conversationId,
        conversations,
        text: 'ping',
        context: { locale: 'en' },
        safetyIdentifier: 'askdare-smoke',
        visitorId: `v_${'0f'.repeat(16)}`,
        messageId: 'msg_smoke',
        signal: AbortSignal.timeout(60_000),
        emit: (event) => events.push(event),
      });
      const text = events
        .flatMap((event) => (event.type === 'text.delta' ? [event.delta] : []))
        .join('');
      expect(text.toLowerCase()).toContain('pong');
      expect(result.usage.outputTokens).toBeGreaterThan(0);
    } finally {
      await conversations.delete(conversationId);
    }
  }, 90_000);

  it('suggest_replies: offers options, keeps the answer visible and the next turn working', async () => {
    const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
    const bot = createBot({
      id: 'smoke',
      model: model ?? '',
      instructions:
        'You help visitors choose between the Basic plan ($5) and the Pro plan ($15). Answer in one sentence.',
      limits: { maxOutputTokens: 512 },
      widget: { replies: 'suggest' },
    });
    const conversationId = await conversations.create({ botId: bot.id, owner: 'visitor:smoke' });
    const ask = async (text: string) => {
      const steps: unknown[] = [];
      const result = await gateway.runTurn({
        bot,
        conversationId,
        conversations,
        text,
        context: { locale: 'en' },
        safetyIdentifier: 'askdare-smoke',
        visitorId: `v_${'0f'.repeat(16)}`,
        messageId: 'msg_smoke',
        signal: AbortSignal.timeout(60_000),
        emit: () => {},
        onStep: (step) => steps.push(step),
      });
      return { result, steps: steps.length };
    };
    try {
      const first = await ask('Which plan should I pick? Offer me a choice.');
      // Which path the model took: 1 step = options after the answer, 2 = one more step.
      console.info(
        `[smoke] suggest_replies: ${first.steps} step(s), ${first.result.replies?.length ?? 0} options`,
      );
      expect(first.result.reason).toBe('completed');
      expect(first.result.answerItemId).toBeDefined();
      const { messages: history } = await readMessages(conversationId, {
        replies: readSuggestedReplies,
      });
      expect(history.at(-1)?.role).toBe('assistant');
      expect(history.at(-1)?.text).not.toBe('');
      // The call was answered: the next turn doesn't need a repair.
      const second = await ask(first.result.replies?.[0] ?? 'Pro, please.');
      expect(second.result.reason).toBe('completed');
    } finally {
      await conversations.delete(conversationId);
    }
  }, 120_000);

  it('handoff: the strict schema is accepted, and the next step leaves the tool out', async () => {
    // ADR-0030: the reason enum and the nullable summary in strict mode; once the turn handed off,
    // `allowed_tools` keeps the tool list (and the prompt cache) but no longer allows `handoff`.
    const recording = recordingFetch();
    const gateway = createOpenAIGateway({
      apiKey: apiKey ?? '',
      maxRetries: 1,
      fetch: recording.fetch,
    });
    const bot = createBot({
      id: 'smoke',
      model: model ?? '',
      instructions:
        'You are the support assistant of a web shop. When the visitor asks for a person, call the handoff tool, then tell them in one sentence what happens next.',
      limits: { maxOutputTokens: 512 },
      tools: [ping],
      handoff: { content: 'summary' },
    });
    const hook = sentHandoff();
    const conversationId = await conversations.create({ botId: bot.id, owner: 'visitor:smoke' });
    try {
      const events: ProtocolEvent[] = [];
      const result = await gateway.runTurn({
        bot,
        conversationId,
        conversations,
        text: 'My kettle arrived broken. I want to talk to a human, please.',
        context: { locale: 'en' },
        safetyIdentifier: 'askdare-smoke',
        visitorId: `v_${'0f'.repeat(16)}`,
        messageId: 'msg_smoke',
        signal: AbortSignal.timeout(60_000),
        emit: (event) => events.push(event),
        handoff: hook,
      });
      const tools = (recording.bodies[0]?.['tools'] ?? []) as { name?: string; strict?: boolean }[];
      expect(tools.find((tool) => tool.name === HANDOFF)?.strict).toBe(true);
      expect(hook.calls).toHaveLength(1);
      const call = JSON.parse(hook.calls[0] ?? '{}') as { reason?: unknown; summary?: unknown };
      expect(HANDOFF_REASONS).toContain(call.reason);
      expect(call.summary === null || typeof call.summary === 'string').toBe(true);
      expect(events.filter((event) => event.type === 'handoff')).toEqual([
        { type: 'handoff', messageId: 'msg_smoke', state: 'requested' },
        { type: 'handoff', messageId: 'msg_smoke', state: 'sent' },
      ]);
      // The step after the handoff: the bot's own tool stays allowed, `handoff` doesn't.
      expect(recording.bodies.length).toBeGreaterThan(1);
      expect(allowedFunctions(recording.bodies[1])).toEqual(['ping']);
      expect(result.reason).toBe('completed');
      const text = events
        .flatMap((event) => (event.type === 'text.delta' ? [event.delta] : []))
        .join('');
      expect(text).not.toBe('');
    } finally {
      await conversations.delete(conversationId);
    }
  }, 120_000);

  it('show_form: the strict enum of form names is accepted, and the form is shown once', async () => {
    // ADR-0031: only forms the model may show are in the enum; `contact` (model: false) isn't.
    const recording = recordingFetch();
    const gateway = createOpenAIGateway({
      apiKey: apiKey ?? '',
      maxRetries: 1,
      fetch: recording.fetch,
    });
    const bot = createBot({
      id: 'smoke',
      model: model ?? '',
      instructions:
        'You are the sales assistant of a software company. When the visitor asks for an offer, show the offer form and say in one sentence that the team will reply.',
      limits: { maxOutputTokens: 512 },
      tools: [ping],
      forms: [offerForm, contactForm],
    });
    const shown: string[] = [];
    const conversationId = await conversations.create({ botId: bot.id, owner: 'visitor:smoke' });
    try {
      const events: ProtocolEvent[] = [];
      const result = await gateway.runTurn({
        bot,
        conversationId,
        conversations,
        text: 'Could you send me an offer for 20 seats?',
        context: { locale: 'en' },
        safetyIdentifier: 'askdare-smoke',
        visitorId: `v_${'0f'.repeat(16)}`,
        messageId: 'msg_smoke',
        signal: AbortSignal.timeout(60_000),
        emit: (event) => events.push(event),
        showForm: async (name) => {
          shown.push(name);
          return { handle: 'smoke-handle' };
        },
      });
      const tool = (
        (recording.bodies[0]?.['tools'] ?? []) as {
          name?: string;
          strict?: boolean;
          parameters?: { properties?: { form?: { enum?: string[] } } };
        }[]
      ).find((candidate) => candidate.name === SHOW_FORM);
      expect(tool?.strict).toBe(true);
      expect(tool?.parameters?.properties?.form?.enum).toEqual(['offer']);
      expect(shown).toEqual(['offer']);
      expect(events.filter((event) => event.type === 'form')).toEqual([
        expect.objectContaining({ name: 'offer', handle: 'smoke-handle', purpose: 'lead' }),
      ]);
      // Called before any text, the form takes one more step, which no longer allows it.
      console.info(`[smoke] show_form: ${recording.bodies.length} step(s)`);
      for (const body of recording.bodies.slice(1)) {
        expect(allowedFunctions(body)).toEqual(['ping']);
      }
      expect(result.reason).toBe('completed');
    } finally {
      await conversations.delete(conversationId);
    }
  }, 120_000);

  it.skipIf(!vectorStoreId)(
    'leaves handoff and show_form out of allowed_tools on the last step',
    async () => {
      // Only a hosted tool keeps `allowed_tools` on the last step; without one it is `none`.
      const recording = recordingFetch();
      const gateway = createOpenAIGateway({
        apiKey: apiKey ?? '',
        maxRetries: 1,
        fetch: recording.fetch,
      });
      const bot = createBot({
        id: 'smoke',
        model: model ?? '',
        instructions:
          'Answer from the documents you can search. When the visitor asks for a person, call the handoff tool; when they ask for an offer, show the offer form.',
        limits: { maxOutputTokens: 512, maxSteps: 1 },
        handoff: true,
        forms: [offerForm],
        knowledge: { vectorStoreId: vectorStoreId ?? '', maxResults: 3 },
      });
      const hook = sentHandoff();
      const shown: string[] = [];
      const conversationId = await conversations.create({
        botId: bot.id,
        owner: 'visitor:smoke',
      });
      try {
        const result = await gateway.runTurn({
          bot,
          conversationId,
          conversations,
          text: 'How much is the Business plan? Then put me through to a person and send me an offer.',
          context: { locale: 'en' },
          safetyIdentifier: 'askdare-smoke',
          visitorId: `v_${'0f'.repeat(16)}`,
          messageId: 'msg_smoke',
          signal: AbortSignal.timeout(60_000),
          emit: () => {},
          handoff: hook,
          showForm: async (name) => {
            shown.push(name);
            return { handle: 'smoke-handle' };
          },
        });
        expect(recording.bodies).toHaveLength(1);
        expect(recording.bodies[0]?.['tool_choice']).toEqual({
          type: 'allowed_tools',
          mode: 'auto',
          tools: [{ type: 'file_search' }],
        });
        expect(hook.calls).toEqual([]);
        expect(shown).toEqual([]);
        expect(result.reason).toBe('completed');
      } finally {
        await conversations.delete(conversationId);
      }
    },
    90_000,
  );

  it('runs a stateless conversation of a few turns from the memory store', async () => {
    // Item store: every request replays the stored items with store:false (ADR-0024).
    const store = memoryConversations();
    const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
    const bot = createBot({
      id: 'smoke',
      model: model ?? '',
      instructions:
        'Answer in one short sentence. Use lookup_order for any order number the visitor gives.',
      limits: { maxOutputTokens: 512 },
      tools: [
        defineTool({
          name: 'lookup_order',
          description: 'Looks up an order by its number.',
          input: z.object({ orderId: z.string() }),
          execute: ({ orderId }) => ({ orderId, status: 'shipped', carrier: 'DPD' }),
        }),
      ],
    });
    const conversationId = await store.create({ botId: bot.id, owner: 'visitor:smoke' });
    const ask = async (text: string) => {
      const events: ProtocolEvent[] = [];
      const result = await gateway.runTurn({
        bot,
        conversationId,
        conversations: store,
        text,
        context: { locale: 'en' },
        safetyIdentifier: 'askdare-smoke',
        visitorId: `v_${'0f'.repeat(16)}`,
        messageId: 'msg_smoke',
        signal: AbortSignal.timeout(60_000),
        emit: (event) => events.push(event),
      });
      const answer = events
        .flatMap((event) => (event.type === 'text.delta' ? [event.delta] : []))
        .join('');
      return { result, answer };
    };
    const first = await ask('Hi, my name is Ada. Where is my order 4711?');
    expect(first.result.reason).toBe('completed');
    expect(first.result.answerItemId).toMatch(/^itm_/);
    expect(first.answer.toLowerCase()).toContain('dpd');
    const second = await ask('Thanks. What was my name again?');
    expect(second.answer.toLowerCase()).toContain('ada');
    const third = await ask('And which carrier was it?');
    expect(third.answer.toLowerCase()).toContain('dpd');
    const { items } = await store.page(conversationId);
    // Every call is stored with its output, and the turn's items follow its visitor message.
    const calls = items.filter((item) => item.type === 'call').map((item) => item.callId);
    const outputs = items.filter((item) => item.type === 'call_output').map((item) => item.callId);
    expect(calls.length).toBeGreaterThan(0);
    expect(outputs).toEqual(calls);
    const { messages: history } = await itemHistory(store)(conversationId, {});
    expect(history.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  }, 180_000);

  it('compacts a long stateless conversation once, after the turn, and the next turn shrinks', async () => {
    // ADR-0029: a pasted document of about 22k tokens crosses compactAt; the compaction runs in
    // the turn's waitUntil work, and the next turn replays a few thousand tokens instead.
    const triggers: unknown[] = [];
    const recording: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const sent = typeof init?.body === 'string' ? init.body : '';
      if (sent.includes('"compaction_trigger"')) triggers.push(await response.clone().json());
      return response;
    };
    const store = memoryConversations();
    const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1, fetch: recording });
    const manual = Array.from(
      { length: 1_100 },
      (_, index) =>
        `Section ${index + 1}: the Model ${index + 1} kettle holds ${(index % 7) + 1} litres and is cleaned with plain water.`,
    );
    manual[611] =
      'Section 612: the warranty on every kettle is 7 years, counted from the delivery date.';
    const bot = createBot({
      id: 'smoke',
      model: model ?? '',
      instructions: 'Answer in one short sentence.',
      limits: { maxOutputTokens: 512, compactAt: 20_000 },
    });
    const reports: ChatUsageReport[] = [];
    const ask = async (text: string, conversationId?: string) => {
      const steps: number[] = [];
      let work: Promise<unknown> = Promise.resolve();
      let created: string | undefined;
      const stream = streamTurn({
        gateway: {
          ...gateway,
          runTurn: (request) =>
            gateway.runTurn({
              ...request,
              onStep: (step) => {
                steps.push(step.usage.inputTokens);
                request.onStep?.(step);
              },
            }),
        },
        conversations: store,
        owner: 'visitor:smoke',
        bot,
        text,
        context: { locale: 'en' },
        visitorId: `v_${'0f'.repeat(16)}`,
        conversationId,
        signal: new AbortController().signal,
        issueResumeToken: async (id) => {
          created = id;
          return 'resume';
        },
        pseudonym: async () => 'askdare-smoke',
        report: (report) => {
          reports.push(report);
        },
        waitUntil: (promise) => {
          work = promise;
        },
      });
      let raw = '';
      const decoder = new TextDecoder();
      for await (const chunk of stream) raw += decoder.decode(chunk, { stream: true });
      await work;
      const answer = raw
        .split('\n')
        .flatMap((line) => (line.startsWith('data: ') ? [JSON.parse(line.slice(6))] : []))
        .flatMap((event: { type: string; delta?: string }) =>
          event.type === 'text.delta' ? [event.delta ?? ''] : [],
        )
        .join('');
      return { answer, steps, conversationId: conversationId ?? created };
    };

    const first = await ask(
      `My name is Ada. Here is our kettle manual:\n${manual.join('\n')}\nHow long is the warranty?`,
    );
    expect(first.answer.toLowerCase()).toMatch(/\b(7|seven)\b/);
    expect(first.steps.at(-1)).toBeGreaterThan(20_000);
    expect(reports[0]?.compaction?.outcome).toBe('compacted');
    expect(reports[0]?.compaction?.usage.outputTokens).toBeGreaterThan(0);
    const [trigger] = triggers as { output: { type: string }[] }[];
    expect(trigger?.output.map((item) => item.type)).toEqual(['compaction']);
    const { items } = await store.page(first.conversationId ?? '');
    expect(
      items.filter((item) => item.type === 'native' && item.kind === 'compaction'),
    ).toHaveLength(1);

    const second = await ask(
      'Thanks. What is my name, and the warranty again?',
      first.conversationId,
    );
    expect(second.answer.toLowerCase()).toContain('ada');
    expect(second.answer.toLowerCase()).toMatch(/\b(7|seven)\b/);
    // The next turn replays the summary instead of the manual.
    expect(second.steps[0]).toBeLessThan(10_000);
    expect(reports[1]?.compaction).toBe(undefined);
    console.info(
      `[smoke] compaction: ${JSON.stringify({ first: first.steps, compaction: reports[0]?.compaction, second: second.steps })}`,
    );
    const record = process.env['SMOKE_RECORD_COMPACTION'];
    if (record) {
      // A fixture for recorded tests, with nothing that could be replayed against OpenAI.
      const redacted = JSON.stringify(
        trigger,
        (key, value: unknown) =>
          key === 'encrypted_content'
            ? 'redacted'
            : key === 'id' && typeof value === 'string'
              ? value.replace(/_[A-Za-z0-9]+$/, '_redacted')
              : key === 'safety_identifier' || key === 'prompt_cache_key'
                ? 'redacted'
                : value,
        2,
      );
      await writeFile(record, `${redacted}\n`);
    }
  }, 240_000);

  it.skipIf(!vectorStoreId)(
    'searches the knowledge base on the last step and cites the source page',
    async () => {
      const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
      const bot = createBot({
        id: 'smoke',
        model: model ?? '',
        instructions: 'Answer from the documents you can search and cite them.',
        // One step: functions are off, file search must stay available (allowed_tools).
        limits: { maxOutputTokens: 512, maxSteps: 1 },
        tools: [
          defineTool({
            name: 'ping',
            description: 'Never needed.',
            input: z.object({}),
            execute: () => 'pong',
          }),
        ],
        knowledge: { vectorStoreId: vectorStoreId ?? '', maxResults: 3 },
      });
      const conversationId = await conversations.create({
        botId: bot.id,
        owner: 'visitor:smoke',
      });
      try {
        const events: ProtocolEvent[] = [];
        await gateway.runTurn({
          bot,
          conversationId,
          conversations,
          text: 'How much does the Business plan cost per user per month?',
          context: { locale: 'en' },
          safetyIdentifier: 'askdare-smoke',
          visitorId: `v_${'0f'.repeat(16)}`,
          messageId: 'msg_smoke',
          signal: AbortSignal.timeout(60_000),
          emit: (event) => events.push(event),
        });
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'tool.status', name: 'file_search', state: 'done' }),
        );
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'citation', url: 'https://example.com/pricing' }),
        );
        const { messages: history } = await readMessages(conversationId, {});
        expect(history.at(-1)?.citations).toContainEqual(
          expect.objectContaining({ url: 'https://example.com/pricing' }),
        );
      } finally {
        await conversations.delete(conversationId);
      }
    },
    90_000,
  );

  it('reads an attached image and PDF, then deletes both with the conversation', async () => {
    const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
    const bot = createBot({
      id: 'smoke',
      model: model ?? '',
      instructions: 'Answer in one short sentence.',
      limits: { maxOutputTokens: 512 },
      attachments: {},
    });
    const imageId = await gateway.uploadFile({
      bytes: solidPng(64, [220, 20, 20]),
      filename: 'square.png',
      mime: 'image/png',
    });
    const pdfId = await gateway.uploadFile({
      bytes: textPdf('The secret word is PELICAN.'),
      filename: 'note.pdf',
      mime: 'application/pdf',
    });
    const conversationId = await conversations.create({ botId: bot.id, owner: 'visitor:smoke' });
    try {
      const events: ProtocolEvent[] = [];
      await gateway.runTurn({
        bot,
        conversationId,
        conversations,
        text: 'What color is the image, and what is the secret word in the PDF?',
        attachments: [
          { fileId: imageId, kind: 'image' },
          { fileId: pdfId, kind: 'pdf' },
        ],
        context: { locale: 'en' },
        safetyIdentifier: 'askdare-smoke',
        visitorId: `v_${'0f'.repeat(16)}`,
        messageId: 'msg_smoke',
        signal: AbortSignal.timeout(60_000),
        emit: (event) => events.push(event),
      });
      const text = events
        .flatMap((event) => (event.type === 'text.delta' ? [event.delta] : []))
        .join('')
        .toLowerCase();
      expect(text).toContain('red');
      expect(text).toContain('pelican');
      const { messages: history } = await readMessages(conversationId, {});
      expect(history[0]).toMatchObject({ role: 'user', attachments: 2 });
    } finally {
      await gateway.deleteFiles((await conversations.delete(conversationId)).fileIds);
    }
    const client = new OpenAI({ apiKey: apiKey ?? '' });
    for (const id of [imageId, pdfId]) {
      await expect(client.files.retrieve(id)).rejects.toBeInstanceOf(NotFoundError);
    }
  }, 120_000);

  it.skipIf(!audioFile || !transcribeModel)(
    'transcribes recorded speech and reports the billed seconds',
    async () => {
      const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
      const extension = extname(audioFile ?? '').slice(1);
      const result = await gateway.transcribe({
        bytes: await readFile(audioFile ?? ''),
        filename: `speech.${extension}`,
        mime: extension === 'wav' ? 'audio/wav' : 'audio/mp4',
        model: transcribeModel ?? '',
        languages: ['pl', 'en'],
      });
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.seconds).toBeGreaterThan(0);
    },
    60_000,
  );
});
