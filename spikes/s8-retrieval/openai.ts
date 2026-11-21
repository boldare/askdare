/**
 * Everything in the spike that talks to OpenAI. Model IDs and prices live here only
 * (checked on developers.openai.com/api/docs/pricing and /guides/embeddings, 2026-11-21).
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import OpenAI, { toFile } from 'openai';
import type { Embedder, KnowledgeDocument } from './port.ts';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/** USD per 1M tokens. */
export const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
  'gpt-6.1-terra': { input: 1, cached: 0.05, output: 5 },
};
export const EMBEDDING_PRICE = 0.02;
export const FILE_SEARCH_CALL_PRICE = 2.5 / 1000;

export function client(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing: put it in spikes/s8-retrieval/.env.');
  }
  return new OpenAI({ timeout: 90_000, maxRetries: 2 });
}

export function openAIEmbedder(openai: OpenAI): Embedder & { totalTokens: number } {
  const embedder = {
    id: `openai:${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}`,
    dimensions: EMBEDDING_DIMENSIONS,
    totalTokens: 0,
    async embed(texts: readonly string[], signal?: AbortSignal) {
      const response = await openai.embeddings.create(
        { model: EMBEDDING_MODEL, input: [...texts], dimensions: EMBEDDING_DIMENSIONS },
        { signal },
      );
      embedder.totalTokens += response.usage.total_tokens;
      return {
        vectors: response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding),
        tokens: response.usage.total_tokens,
      };
    },
  };
  return embedder;
}

/** IDs of everything created at OpenAI, written before use so `cleanup.ts` can remove leftovers. */
const LEDGER = join(import.meta.dirname, '.created.json');
type Ledger = { vectorStores: string[]; files: string[] };

export async function readLedger(): Promise<Ledger> {
  if (!existsSync(LEDGER)) return { vectorStores: [], files: [] };
  return JSON.parse(await readFile(LEDGER, 'utf8')) as Ledger;
}
async function record(update: (ledger: Ledger) => void): Promise<void> {
  const ledger = await readLedger();
  update(ledger);
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2));
}
export async function forget(kind: keyof Ledger, id: string): Promise<void> {
  await record((ledger) => {
    ledger[kind] = ledger[kind].filter((existing) => existing !== id);
  });
}

const UPLOAD_EXTENSIONS: Record<string, string> = { '.mdx': '.md', '.htm': '.html' };

/** The baseline: what `askdare kb sync` builds today (same attributes, same upload names). */
export async function createVectorStore(
  openai: OpenAI,
  root: string,
  documents: readonly KnowledgeDocument[],
): Promise<string> {
  const store = await openai.vectorStores.create({ name: 'askdare spike s8 (delete me)' });
  await record((ledger) => ledger.vectorStores.push(store.id));
  for (const document of documents) {
    const extension = extname(document.path);
    const name = `${basename(document.path, extension)}${UPLOAD_EXTENSIONS[extension] ?? extension}`;
    const file = await openai.files.create({
      file: await toFile(await readFile(join(root, document.path)), name),
      purpose: 'assistants',
    });
    await record((ledger) => ledger.files.push(file.id));
    const attached = await openai.vectorStores.files.createAndPoll(store.id, {
      file_id: file.id,
      attributes: {
        path: document.path,
        sha256: document.sha256,
        title: document.title,
        ...(document.url ? { url: document.url } : {}),
      },
    });
    if (attached.status !== 'completed') {
      throw new Error(`${document.path}: ${attached.last_error?.message ?? attached.status}`);
    }
  }
  return store.id;
}

export async function deleteEverything(openai: OpenAI, log: (line: string) => void): Promise<void> {
  const ledger = await readLedger();
  for (const id of ledger.vectorStores) {
    try {
      await openai.vectorStores.delete(id);
      log(`deleted vector store ${id}`);
    } catch (error) {
      if (!(error instanceof OpenAI.NotFoundError)) throw error;
      log(`vector store ${id} already gone`);
    }
    await forget('vectorStores', id);
  }
  for (const id of ledger.files) {
    try {
      await openai.files.delete(id);
      log(`deleted file ${id}`);
    } catch (error) {
      if (!(error instanceof OpenAI.NotFoundError)) throw error;
      log(`file ${id} already gone`);
    }
    await forget('files', id);
  }
}
