import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { embeddingInput } from '../knowledge/document';
import { scanDirectory, scanKnowledgeDocuments } from './kb-folder';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'askdare-kb-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('scanDirectory (vector stores)', () => {
  it('reads titles and URLs from front matter or the manifest and skips other files', async () => {
    await mkdir(join(root, 'guides'));
    await writeFile(
      join(root, 'guides', 'pricing.md'),
      '---\ntitle: "Pricing"\nurl: https://example.com/pricing\n---\n# Plans\n',
    );
    await writeFile(join(root, 'handbook.pdf'), '%PDF-1.4 fake');
    await writeFile(join(root, 'notes.txt'), 'plain');
    await writeFile(join(root, 'logo.png'), 'png');
    await writeFile(join(root, '.secret.md'), 'hidden');
    await writeFile(
      join(root, 'askdare.kb.json'),
      JSON.stringify({
        'handbook.pdf': { title: 'Team handbook', url: 'https://example.com/handbook' },
      }),
    );
    const { documents, skipped } = await scanDirectory(root);
    expect(documents.map(({ path, title, url }) => ({ path, title, url }))).toEqual([
      { path: 'guides/pricing.md', title: 'Pricing', url: 'https://example.com/pricing' },
      { path: 'handbook.pdf', title: 'Team handbook', url: 'https://example.com/handbook' },
      { path: 'notes.txt', title: 'notes', url: undefined },
    ]);
    expect(skipped).toEqual(['logo.png']);
    expect(documents[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects URLs that are not http(s)', async () => {
    await writeFile(join(root, 'bad.md'), '---\nurl: javascript:alert(1)\n---\n');
    await expect(scanDirectory(root)).rejects.toThrow(/bad\.md: url must be an http\(s\) URL/);
  });

  it('rejects a manifest that is not JSON', async () => {
    await writeFile(join(root, 'askdare.kb.json'), '{');
    await expect(scanDirectory(root)).rejects.toThrow('askdare.kb.json is not valid JSON.');
  });
});

describe('scanKnowledgeDocuments (our own index)', () => {
  it('extracts and chunks the formats the index reads, and skips the rest', async () => {
    await mkdir(join(root, 'guides'));
    await writeFile(
      join(root, 'guides', 'pricing.md'),
      '---\ntitle: Pricing\nurl: https://example.com/pricing\n---\n# Plans\n\nPro costs 10 USD.\n',
    );
    await writeFile(
      join(root, 'about.html'),
      '<html><head><title>x</title><script>alert(1)</script></head><body><h1>About</h1><p>We help.</p></body></html>',
    );
    await writeFile(join(root, 'intro.mdx'), "import X from './x'\n\n# Intro\n\nHello.\n");
    await writeFile(join(root, 'notes.txt'), 'plain notes');
    await writeFile(join(root, 'handbook.pdf'), '%PDF-1.4 fake');
    await writeFile(join(root, 'faq.json'), '{"q":"a"}');
    await writeFile(
      join(root, 'askdare.kb.json'),
      JSON.stringify({ 'about.html': { title: 'About us', url: 'https://example.com/about' } }),
    );

    const { documents, skipped, empty } = await scanKnowledgeDocuments(root);
    expect(skipped).toEqual(['faq.json', 'handbook.pdf']);
    expect(empty).toEqual([]);
    expect(documents.map(({ path, title, url }) => ({ path, title, url }))).toEqual([
      { path: 'about.html', title: 'About us', url: 'https://example.com/about' },
      { path: 'guides/pricing.md', title: 'Pricing', url: 'https://example.com/pricing' },
      { path: 'intro.mdx', title: 'intro', url: undefined },
      { path: 'notes.txt', title: 'notes', url: undefined },
    ]);
    const pricing = documents[1];
    expect(pricing?.chunks).toEqual([
      expect.objectContaining({ section: 'Plans', text: expect.stringContaining('Pro costs') }),
    ]);
    expect(
      pricing && embeddingInput(pricing, pricing.chunks[0] ?? { section: '', text: '' }),
    ).toMatch(/^Pricing — Plans\n\n/);
    const html = documents[0]?.chunks.map((chunk) => chunk.text).join('\n') ?? '';
    expect(html).toContain('We help.');
    expect(html).not.toMatch(/alert|<|>/);
    expect(documents[2]?.chunks.map((chunk) => chunk.text).join('\n')).not.toContain('import');
  });

  it('keeps the vector-store hash, so both targets name a file version the same way', async () => {
    await writeFile(join(root, 'a.md'), '# A\n\nText.\n');
    const [own] = (await scanKnowledgeDocuments(root)).documents;
    const [store] = (await scanDirectory(root)).documents;
    expect(own?.sha256).toBe(store?.sha256);
  });

  it('reports readable files with no text instead of syncing them', async () => {
    await writeFile(join(root, 'app.html'), '<script>render()</script>');
    await writeFile(join(root, 'blank.md'), '---\ntitle: Blank\n---\n');
    const { documents, empty } = await scanKnowledgeDocuments(root);
    expect(documents).toEqual([]);
    expect(empty).toEqual(['app.html', 'blank.md']);
  });

  it('passes the chunk size on', async () => {
    await writeFile(
      join(root, 'long.md'),
      `# Long\n\n${Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join('\n\n')}\n`,
    );
    const small = await scanKnowledgeDocuments(root, { maxTokens: 50 });
    const large = await scanKnowledgeDocuments(root);
    expect(small.documents[0]?.chunks.length ?? 0).toBeGreaterThan(
      large.documents[0]?.chunks.length ?? 0,
    );
  });
});
