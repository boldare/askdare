import { createHash, randomUUID } from 'node:crypto';
import { knowledgeDocument, sourceIdOf } from './document';
import { fakeEmbedder } from './fake-embedder';
import type { Embedder, KnowledgeChunk, KnowledgeDocument, KnowledgeIndex, Passage } from './port';

/** The matchers the suite uses; Vitest's and Jest's `expect` fit. */
export type ContractExpect = (actual: unknown) => {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(length: number): void;
  toBeGreaterThan(expected: number): void;
};

export interface KnowledgeIndexContractOptions {
  readonly describe: (name: string, body: () => void) => void;
  readonly it: (name: string, body: () => Promise<void>) => void;
  readonly expect: ContractExpect;
  /**
   * Opens the index `indexId` with `embedder`. Two calls with the same index ID must see the same
   * data, as two server instances on one database do. Each test uses fresh index IDs and clears them.
   */
  readonly open: (options: {
    readonly indexId: string;
    readonly embedder: Embedder;
  }) => KnowledgeIndex | Promise<KnowledgeIndex>;
  /** Of the fake embedder; set it for an index with fixed dimensions. Default 64. */
  readonly dimensions?: number;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

function doc(path: string, title: string, text: string, url?: string): KnowledgeDocument {
  return knowledgeDocument({
    path,
    sha256: sha256(`${title}\n${url ?? ''}\n${text}`),
    title,
    url,
    text,
  });
}

const PRICING = [
  '# Plans',
  'The Team plan costs 12 euros per seat each month.',
  '## Billing',
  'Invoices are sent on the first working day of the month.',
  '## Refunds',
  'Refunds are possible within 14 days of purchase.',
].join('\n\n');
const API = [
  '# Webhooks',
  'Every webhook carries an X-Brightloop-Signature header signed with your secret.',
  '# Rate limits',
  'The API allows 600 requests per minute per key.',
].join('\n\n');

function fixtures(): KnowledgeDocument[] {
  return [
    doc('pricing.md', 'Pricing', PRICING, 'https://example.test/pricing'),
    doc('api.md', 'API reference', API),
    doc('support.txt', 'Support', 'Support answers within one business day, Monday to Friday.'),
  ];
}

function chunkOf(document: KnowledgeDocument | undefined, words: string): KnowledgeChunk {
  const chunk = document?.chunks.find((candidate) => candidate.text.includes(words));
  if (chunk === undefined) throw new Error(`No fixture chunk contains "${words}".`);
  return chunk;
}

const uniqueChunks = (documents: readonly KnowledgeDocument[]): number =>
  new Set(documents.flatMap((document) => document.chunks.map((chunk) => chunk.sha256))).size;

async function rejects(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch {
    return true;
  }
}

/**
 * Behaviour every `KnowledgeIndex` must have (ADR-0025), with a deterministic fake embedder. Used
 * by the in-memory index and by adapters such as `pgvectorIndex`, so they stay interchangeable.
 * Runner-agnostic: pass your test runner's `describe`, `it` and `expect`.
 */
export function knowledgeIndexContract(name: string, options: KnowledgeIndexContractOptions): void {
  const { describe, it, expect } = options;
  const embedder = fakeEmbedder(
    options.dimensions === undefined ? {} : { dimensions: options.dimensions },
  );

  /** Runs a test with fresh index IDs, and clears every index it opened, also after a failure. */
  const test = (
    title: string,
    body: (open: (key?: string, other?: Embedder) => Promise<KnowledgeIndex>) => Promise<void>,
  ): void => {
    it(title, async () => {
      const prefix = `contract-${randomUUID()}`;
      const opened = new Set<string>();
      const open = async (
        key = 'a',
        withEmbedder: Embedder = embedder,
      ): Promise<KnowledgeIndex> => {
        opened.add(`${prefix}-${key}`);
        return options.open({ indexId: `${prefix}-${key}`, embedder: withEmbedder });
      };
      try {
        await body(open);
      } finally {
        for (const indexId of opened) {
          await Promise.resolve(options.open({ indexId, embedder }))
            .then((index) => index.clear())
            .catch(() => undefined);
        }
      }
    });
  };

  const synced = async (index: KnowledgeIndex): Promise<boolean | undefined> =>
    (await index.diagnose()).find((check) => check.id === 'knowledge.synced')?.ok;

  describe(`${name} (KnowledgeIndex contract)`, () => {
    test('starts empty', async (open) => {
      const index = await open();
      expect(await index.search('webhook', { maxResults: 5 })).toEqual([]);
      expect(await index.passage(sourceIdOf(sha256('nothing')))).toBe(undefined);
      expect(await synced(index)).toBe(false);
    });

    test('syncs documents and reports what it embedded', async (open) => {
      const index = await open();
      const documents = fixtures();
      const report = await index.sync(documents);
      expect([...report.added].sort()).toEqual(['api.md', 'pricing.md', 'support.txt']);
      expect(report.changed).toEqual([]);
      expect(report.removed).toEqual([]);
      expect(report.unchanged).toBe(0);
      expect(report.embeddedChunks).toBe(uniqueChunks(documents));
      expect(report.reusedChunks).toBe(0);
      expect(report.embeddingTokens).toBeGreaterThan(0);
      expect(await synced(index)).toBe(true);
      expect((await index.diagnose()).find((check) => check.id === 'knowledge.embedder')?.ok).toBe(
        true,
      );
    });

    test('finds the matching passage first, with its document and a score', async (open) => {
      const index = await open();
      const documents = fixtures();
      await index.sync(documents);
      const results = await index.search('X-Brightloop-Signature webhook header', {
        maxResults: 3,
      });
      const expected = chunkOf(documents[1], 'X-Brightloop-Signature');
      expect(results.length > 0 && results.length <= 3).toBe(true);
      const [first] = results;
      expect({ ...first, score: undefined }).toEqual({
        sourceId: expected.sourceId,
        path: 'api.md',
        title: 'API reference',
        url: undefined,
        section: 'Webhooks',
        text: expected.text,
        score: undefined,
      });
      const scores = results.map((result) => result.score);
      expect(scores.every((score) => typeof score === 'number')).toBe(true);
      expect(scores.every((score, i) => i === 0 || (score ?? 0) <= (scores[i - 1] ?? 0))).toBe(
        true,
      );
      expect(new Set(results.map((result) => result.sourceId)).size).toBe(results.length);
    });

    test('returns at most maxResults', async (open) => {
      const index = await open();
      await index.sync(fixtures());
      expect(await index.search('plan month refunds invoices', { maxResults: 1 })).toHaveLength(1);
    });

    test('resolves source IDs, also in another instance', async (open) => {
      const index = await open();
      const documents = fixtures();
      await index.sync(documents);
      const chunk = chunkOf(documents[0], 'Invoices');
      const expected: Passage = {
        sourceId: chunk.sourceId,
        path: 'pricing.md',
        title: 'Pricing',
        url: 'https://example.test/pricing',
        section: 'Plans › Billing',
        text: chunk.text,
      };
      expect(await index.passage(chunk.sourceId)).toEqual(expected);
      expect(await (await open()).passage(chunk.sourceId)).toEqual(expected);
      expect(await index.passage(sourceIdOf(sha256('unknown')))).toBe(undefined);
      expect(await index.passage('k1')).toBe(undefined);
    });

    test('skips unchanged documents', async (open) => {
      const index = await open();
      await index.sync(fixtures());
      const report = await index.sync(fixtures());
      expect(report).toEqual({
        added: [],
        changed: [],
        removed: [],
        unchanged: 3,
        embeddedChunks: 0,
        reusedChunks: 0,
        embeddingTokens: 0,
      });
    });

    test('embeds only the chunks that changed', async (open) => {
      const index = await open();
      const before = fixtures();
      await index.sync(before);
      const edited = doc(
        'pricing.md',
        'Pricing',
        PRICING.replace('14 days', '30 days'),
        'https://example.test/pricing',
      );
      const report = await index.sync([edited, ...before.slice(1)]);
      expect(report.changed).toEqual(['pricing.md']);
      expect(report.unchanged).toBe(2);
      expect(report.embeddedChunks).toBe(1);
      expect(report.reusedChunks).toBe(edited.chunks.length - 1);
      expect(await index.passage(chunkOf(before[0], '14 days').sourceId)).toBe(undefined);
      expect((await index.passage(chunkOf(edited, '30 days').sourceId))?.text).toBe(
        chunkOf(edited, '30 days').text,
      );
      expect((await index.passage(chunkOf(before[0], 'Invoices').sourceId))?.path).toBe(
        'pricing.md',
      );
    });

    test('keeps source IDs and embeddings across a rename', async (open) => {
      const index = await open();
      const before = fixtures();
      await index.sync(before);
      const renamed = doc('reference/api.md', 'API reference', API);
      const report = await index.sync(
        [before[0], renamed, before[2]].filter((d) => d !== undefined),
      );
      expect(report.added).toEqual(['reference/api.md']);
      expect(report.removed).toEqual(['api.md']);
      expect(report.embeddedChunks).toBe(0);
      const id = chunkOf(before[1], 'X-Brightloop-Signature').sourceId;
      expect(chunkOf(renamed, 'X-Brightloop-Signature').sourceId).toBe(id);
      expect((await index.passage(id))?.path).toBe('reference/api.md');
    });

    test('updates a URL without embedding', async (open) => {
      const index = await open();
      const before = fixtures();
      await index.sync(before);
      const moved = doc('pricing.md', 'Pricing', PRICING, 'https://example.test/plans');
      const report = await index.sync([moved, ...before.slice(1)]);
      expect(report.changed).toEqual(['pricing.md']);
      expect(report.embeddedChunks).toBe(0);
      expect((await index.passage(chunkOf(moved, 'Invoices').sourceId))?.url).toBe(
        'https://example.test/plans',
      );
    });

    test('removes documents that are gone', async (open) => {
      const index = await open();
      const before = fixtures();
      await index.sync(before);
      const report = await index.sync(before.slice(0, 2));
      expect(report.removed).toEqual(['support.txt']);
      expect(await index.passage(chunkOf(before[2], 'business day').sourceId)).toBe(undefined);
      const results = await index.search('support business day', { maxResults: 10 });
      expect(results.some((result) => result.path === 'support.txt')).toBe(false);
      expect((await index.sync([])).removed.length).toBe(2);
      expect(await index.search('webhook', { maxResults: 5 })).toEqual([]);
    });

    test('refuses two different chunks with one source ID, and changes nothing', async (open) => {
      const index = await open();
      const before = fixtures();
      await index.sync(before);
      const original = chunkOf(before[1], 'X-Brightloop-Signature');
      const tail = original.sha256.slice(12) === '0'.repeat(52) ? '1' : '0';
      const forged = original.sha256.slice(0, 12) + tail.repeat(52);
      const intruder: KnowledgeDocument = {
        ...doc('intruder.md', 'Intruder', 'Different text.'),
        chunks: [
          {
            sourceId: sourceIdOf(forged),
            section: undefined,
            text: 'Different text.',
            sha256: forged,
          },
        ],
      };
      expect(await rejects(index.sync([...before, intruder]))).toBe(true);
      expect((await index.passage(original.sourceId))?.text).toBe(original.text);
      expect((await index.sync(before)).unchanged).toBe(3);
    });

    test('embeds everything again for a different embedder', async (open) => {
      const index = await open();
      const documents = fixtures();
      await index.sync(documents);
      const other = fakeEmbedder({ dimensions: embedder.dimensions, id: `${embedder.id}:other` });
      const switched = await open('a', other);
      expect(
        (await switched.diagnose()).find((check) => check.id === 'knowledge.embedder')?.ok,
      ).toBe(false);
      const report = await switched.sync(documents);
      expect(report.embeddedChunks).toBe(uniqueChunks(documents));
      expect(
        (await switched.diagnose()).find((check) => check.id === 'knowledge.embedder')?.ok,
      ).toBe(true);
    });

    test('keeps indexes apart', async (open) => {
      const first = await open('a');
      const second = await open('b');
      const documents = fixtures();
      await first.sync(documents);
      const id = chunkOf(documents[0], 'Invoices').sourceId;
      expect(await second.search('invoices', { maxResults: 5 })).toEqual([]);
      expect(await second.passage(id)).toBe(undefined);
      await second.clear();
      expect((await first.passage(id))?.path).toBe('pricing.md');
    });

    test('clears everything', async (open) => {
      const index = await open();
      const documents = fixtures();
      await index.sync(documents);
      await index.clear();
      expect(await index.search('webhook', { maxResults: 5 })).toEqual([]);
      expect(await index.passage(chunkOf(documents[0], 'Invoices').sourceId)).toBe(undefined);
      expect(await synced(index)).toBe(false);
    });

    test('stops a search when aborted', async (open) => {
      const index = await open();
      await index.sync(fixtures());
      const controller = new AbortController();
      controller.abort();
      expect(
        await rejects(index.search('webhook', { maxResults: 5, signal: controller.signal })),
      ).toBe(true);
    });
  });
}
