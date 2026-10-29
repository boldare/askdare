/**
 * Live smoke test against the real OpenAI API. Never part of `pnpm test`.
 *
 * Run with a key from a dedicated OpenAI project that has a hard spend limit:
 *   OPENAI_API_KEY=… SMOKE_MODEL=<cheap current model> pnpm smoke
 * Add SMOKE_VECTOR_STORE_ID (a store synced from examples/starter/knowledge) for the file search turn,
 * and SMOKE_AUDIO_FILE (a short recording of speech) with SMOKE_TRANSCRIBE_MODEL for dictation.
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import OpenAI, { NotFoundError } from 'openai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineBot } from '../bot/define-bot';
import type { ProtocolEvent } from '../protocol/events';
import { defineTool } from '../tools/define-tool';
import { createOpenAIGateway } from './gateway';

const apiKey = process.env['OPENAI_API_KEY'];
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

describe.skipIf(!apiKey || !model)('OpenAI gateway (live)', () => {
  it('runs a text turn in a new conversation and cleans up', async () => {
    const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
    const bot = defineBot({
      id: 'smoke',
      model: model ?? '',
      instructions: 'Reply with exactly one word: pong.',
      limits: { maxOutputTokens: 64 },
    });
    const conversationId = await gateway.createConversation({ botId: bot.id, visitorId: 'smoke' });
    try {
      const events: ProtocolEvent[] = [];
      const result = await gateway.runTurn({
        bot,
        conversationId,
        text: 'ping',
        context: { locale: 'en' },
        safetyIdentifier: 'chatdock-smoke',
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
      await gateway.deleteConversation(conversationId);
    }
  }, 90_000);

  it.skipIf(!vectorStoreId)(
    'searches the knowledge base on the last step and cites the source page',
    async () => {
      const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
      const bot = defineBot({
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
      const conversationId = await gateway.createConversation({
        botId: bot.id,
        visitorId: 'smoke',
      });
      try {
        const events: ProtocolEvent[] = [];
        await gateway.runTurn({
          bot,
          conversationId,
          text: 'How much does the Business plan cost per user per month?',
          context: { locale: 'en' },
          safetyIdentifier: 'chatdock-smoke',
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
        const history = await gateway.listMessages(conversationId);
        expect(history.at(-1)?.citations).toContainEqual(
          expect.objectContaining({ url: 'https://example.com/pricing' }),
        );
      } finally {
        await gateway.deleteConversation(conversationId);
      }
    },
    90_000,
  );

  it('reads an attached image and PDF, then deletes both with the conversation', async () => {
    const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
    const bot = defineBot({
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
    const conversationId = await gateway.createConversation({ botId: bot.id, visitorId: 'smoke' });
    try {
      const events: ProtocolEvent[] = [];
      await gateway.runTurn({
        bot,
        conversationId,
        text: 'What color is the image, and what is the secret word in the PDF?',
        attachments: [
          { fileId: imageId, kind: 'image' },
          { fileId: pdfId, kind: 'pdf' },
        ],
        context: { locale: 'en' },
        safetyIdentifier: 'chatdock-smoke',
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
      const history = await gateway.listMessages(conversationId);
      expect(history[0]).toMatchObject({ role: 'user', attachments: 2 });
    } finally {
      await gateway.deleteConversation(conversationId, { withFiles: true });
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
