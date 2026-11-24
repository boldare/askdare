import { describe, expect, it } from 'vitest';
import { chunkText, MAX_CHUNK_TOKENS } from './chunk';

const tokens = (text: string): number => Math.ceil(text.length / 4);

describe('chunkText', () => {
  it('keeps chunks within one section and carries the heading trail', () => {
    const chunks = chunkText(
      [
        'Intro before any heading.',
        '# Pricing',
        'Plans in short.',
        '## Billing',
        'Invoices monthly.',
        '### Taxes',
        'VAT is added.',
        '## Refunds',
        'Within 14 days.',
        '# Support',
        'One business day.',
      ].join('\n\n'),
    );
    expect(chunks).toEqual([
      { section: undefined, text: 'Intro before any heading.' },
      { section: 'Pricing', text: 'Plans in short.' },
      { section: 'Pricing › Billing', text: 'Invoices monthly.' },
      { section: 'Pricing › Billing › Taxes', text: 'VAT is added.' },
      { section: 'Pricing › Refunds', text: 'Within 14 days.' },
      { section: 'Support', text: 'One business day.' },
    ]);
  });

  it('reads headings without blank lines around them, closing hashes and setext headings', () => {
    const chunks = chunkText('Title\n=====\nFirst.\n## Second ##\nText.\n\nSub\n---\nMore.');
    expect(chunks).toEqual([
      { section: 'Title', text: 'First.' },
      { section: 'Title › Second', text: 'Text.' },
      { section: 'Title › Sub', text: 'More.' },
    ]);
  });

  it('skips missing heading levels and drops sections with no text', () => {
    expect(chunkText('# A\n\n### C\n\nText.\n\n## Empty\n\n## B\n\nMore.')).toEqual([
      { section: 'A › C', text: 'Text.' },
      { section: 'A › B', text: 'More.' },
    ]);
  });

  it('packs small paragraphs of one section together', () => {
    const chunks = chunkText('# A\n\nOne.\n\nTwo.\n\nThree.');
    expect(chunks).toEqual([{ section: 'A', text: 'One.\n\nTwo.\n\nThree.' }]);
  });

  it('keeps a table whole when it fits', () => {
    const table = ['| Plan | Price |', '| --- | --- |', '| Team | 12 |', '| Business | 30 |'].join(
      '\n',
    );
    const filler = 'word '.repeat(270).trim();
    const chunks = chunkText(`# Plans\n\n${filler}\n\n${table}`);
    expect(chunks.map((chunk) => chunk.text)).toEqual([filler, table]);
  });

  it('splits a long table by rows and repeats its header', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `| Plan ${i} | ${i * 10} euros per month |`);
    const header = '| Plan | Price |\n| --- | --- |';
    const chunks = chunkText(`# Plans\n\n${header}\n${rows.join('\n')}`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.section).toBe('Plans');
      expect(chunk.text.startsWith(`${header}\n|`)).toBe(true);
      expect(tokens(chunk.text)).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
    }
    const body = chunks.flatMap((chunk) => chunk.text.split('\n').slice(2));
    expect(body).toEqual(rows);
  });

  it('splits a long section into chunks of at most about 350 tokens, losing nothing', () => {
    const sentences = Array.from(
      { length: 120 },
      (_, i) => `Sentence number ${i} says something useful.`,
    );
    const paragraphs = [sentences.slice(0, 60).join(' '), sentences.slice(60).join(' ')];
    const chunks = chunkText(`# Long\n\n${paragraphs.join('\n\n')}`);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.section).toBe('Long');
      expect(tokens(chunk.text)).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
    }
    expect(
      chunks
        .map((chunk) => chunk.text)
        .join(' ')
        .split(/\s+/),
    ).toEqual(paragraphs.join(' ').split(/\s+/));
  });

  it('cuts a single word longer than a chunk', () => {
    const chunks = chunkText('x'.repeat(3000), { maxTokens: 100 });
    expect(chunks.map((chunk) => chunk.text.length)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 200,
    ]);
  });

  it('keeps fenced code whole and never reads its lines as headings', () => {
    const code = '```sh\n# not a heading\n\ncurl https://example.test\n```';
    expect(chunkText(`# Setup\n\n${code}\n\nAfter.`)).toEqual([
      { section: 'Setup', text: `${code}\n\nAfter.` },
    ]);
  });

  it('repeats the fences when a long code block is split', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `echo line ${i}`);
    const chunks = chunkText(`\`\`\`sh\n${lines.join('\n')}\n\`\`\``);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text).toMatch(/^```sh\n[\s\S]*\n```$/);
  });

  it('is deterministic and handles CRLF and empty text', () => {
    const text = '# A\r\n\r\nOne.\r\n\r\n## B\r\n\r\nTwo.';
    expect(chunkText(text)).toEqual(chunkText(text.replace(/\r/g, '')));
    expect(chunkText(text)).toEqual(chunkText(text));
    expect(chunkText('')).toEqual([]);
    expect(chunkText('\n\n# Only a heading\n\n')).toEqual([]);
  });
});
