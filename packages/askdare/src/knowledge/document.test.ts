import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkKnowledgeDocuments,
  chunkSha256,
  embeddingInput,
  knowledgeDocument,
  sourceIdOf,
} from './document';
import type { KnowledgeDocument } from './port';

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const TEXT = '# Pricing\n\nThe Team plan costs 12 euros.\n\n## Refunds\n\nWithin 14 days.';

const build = (path: string, title = 'Pricing', text = TEXT): KnowledgeDocument =>
  knowledgeDocument({ path, sha256: hash(text), title, url: 'https://example.test/pricing', text });

describe('knowledgeDocument', () => {
  it('chunks the text and derives each source ID from the chunk hash', () => {
    const document = build('pricing.md');
    expect(document.chunks).toHaveLength(2);
    const [first] = document.chunks;
    expect(first?.sha256).toBe(hash('Pricing\nPricing\nThe Team plan costs 12 euros.'));
    expect(first?.sha256).toBe(chunkSha256('Pricing', 'Pricing', 'The Team plan costs 12 euros.'));
    expect(first?.sourceId).toMatch(/^k[0-9a-f]{12}$/);
    expect(first?.sourceId).toBe(`k${first?.sha256.slice(0, 12)}`);
  });

  it('gives the same source IDs on every run and after a rename', () => {
    const ids = (document: KnowledgeDocument) => document.chunks.map((chunk) => chunk.sourceId);
    expect(ids(build('pricing.md'))).toEqual(ids(build('pricing.md')));
    expect(ids(build('plans/pricing.md'))).toEqual(ids(build('pricing.md')));
  });

  it('gives new source IDs when the title, section or text changes', () => {
    const before = build('pricing.md').chunks.map((chunk) => chunk.sourceId);
    const retitled = build('pricing.md', 'Plans').chunks.map((chunk) => chunk.sourceId);
    expect(retitled.some((id) => before.includes(id))).toBe(false);
    const edited = build('pricing.md', 'Pricing', TEXT.replace('14', '30')).chunks.map(
      (chunk) => chunk.sourceId,
    );
    expect(edited[0]).toBe(before[0]);
    expect(edited[1]).not.toBe(before[1]);
    expect(chunkSha256('T', 'A', 'x')).not.toBe(chunkSha256('T', 'B', 'x'));
  });

  it('refuses a URL that is not http(s)', () => {
    expect(() =>
      knowledgeDocument({
        path: 'a.md',
        sha256: hash('a'),
        title: 'A',
        url: 'javascript:alert(1)',
        text: 'a',
      }),
    ).toThrow(/http\(s\)/);
  });
});

describe('embeddingInput', () => {
  it('puts the title and section above the text', () => {
    expect(
      embeddingInput({ title: 'Pricing' }, { section: 'Plans › Billing', text: 'Monthly.' }),
    ).toBe('Pricing — Plans › Billing\n\nMonthly.');
    expect(embeddingInput({ title: 'Support' }, { section: undefined, text: 'Daily.' })).toBe(
      'Support\n\nDaily.',
    );
  });
});

describe('checkKnowledgeDocuments', () => {
  it('accepts the same chunk in two documents', () => {
    expect(() => checkKnowledgeDocuments([build('a.md'), build('b.md')])).not.toThrow();
  });

  it('refuses two different chunks that would share a source ID', () => {
    const document = build('a.md');
    const original = document.chunks[0];
    if (original === undefined) throw new Error('no chunk');
    const forged =
      `${original.sha256.slice(0, 12)}${original.sha256.at(-1) === '0' ? '1' : '0'}`.padEnd(
        64,
        'a',
      );
    const intruder: KnowledgeDocument = {
      ...build('b.md', 'Other', 'Other text.'),
      chunks: [
        { sourceId: sourceIdOf(forged), section: undefined, text: 'Other text.', sha256: forged },
      ],
    };
    expect(() => checkKnowledgeDocuments([document, intruder])).toThrow(/two different chunks/);
  });

  it('refuses a source ID that does not match its hash, a repeated path and a bad hash', () => {
    const document = build('a.md');
    const chunks = document.chunks.map((chunk) => ({ ...chunk, sourceId: 'k000000000000' }));
    expect(() => checkKnowledgeDocuments([{ ...document, chunks }])).toThrow(/doesn't match/);
    expect(() => checkKnowledgeDocuments([document, document])).toThrow(/appears twice/);
    expect(() => checkKnowledgeDocuments([{ ...document, sha256: 'abc' }])).toThrow(/sha256/);
    expect(() => checkKnowledgeDocuments([{ ...document, path: '/etc/a.md' }])).toThrow(/relative/);
  });
});
