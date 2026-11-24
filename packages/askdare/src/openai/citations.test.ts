import type { ResponseFileSearchToolCall } from 'openai/resources/responses/responses';
import { describe, expect, it } from 'vitest';
import {
  addSources,
  citationSource,
  type KnowledgeSources,
  MarkerMerger,
  mergeRepeatedMarkers,
} from './citations';

type Results = NonNullable<ResponseFileSearchToolCall['results']> | null;

function searchCall(results: Results): ResponseFileSearchToolCall {
  return { id: 'fs_1', type: 'file_search_call', status: 'completed', queries: ['q'], results };
}

function sourcesFrom(results: Results): KnowledgeSources {
  const sources: KnowledgeSources = new Map();
  addSources(searchCall(results), sources);
  return sources;
}

describe('addSources', () => {
  it('keeps the title and URL that kb sync stored with each file', () => {
    const sources = sourcesFrom([
      {
        file_id: 'file-a',
        filename: 'pricing.md',
        attributes: { title: '  Pricing  ', url: 'https://example.com/pricing' },
      },
    ]);
    expect(sources.get('file-a')).toEqual({ title: 'Pricing', url: 'https://example.com/pricing' });
  });

  it('falls back to the file name, and drops URLs that are not http(s)', () => {
    const sources = sourcesFrom([
      {
        file_id: 'file-a',
        filename: 'faq.md',
        attributes: { title: '   ', url: 'javascript:alert(1)' },
      },
      {
        file_id: 'file-b',
        filename: 'terms.pdf',
        attributes: { url: `https://e.com/${'a'.repeat(600)}` },
      },
      { file_id: 'file-c', attributes: { url: 'https://e.com/has space' } },
    ]);
    expect(sources.get('file-a')).toEqual({ title: 'faq.md', url: undefined });
    expect(sources.get('file-b')).toEqual({ title: 'terms.pdf', url: undefined });
    expect(sources.get('file-c')).toEqual({ title: undefined, url: undefined });
  });

  it('caps long titles', () => {
    const sources = sourcesFrom([{ file_id: 'file-a', attributes: { title: 'x'.repeat(500) } }]);
    expect(sources.get('file-a')?.title).toHaveLength(200);
  });

  it('skips results without a file ID and calls without results', () => {
    const sources = sourcesFrom([{ filename: 'orphan.md' }]);
    expect(sources.size).toBe(0);
    addSources(searchCall(null), sources);
    expect(sources.size).toBe(0);
  });
});

describe('citationSource', () => {
  const sources = sourcesFrom([
    {
      file_id: 'file-a',
      filename: 'a.md',
      attributes: { title: 'Plans', url: 'https://e.com/plans' },
    },
    {
      file_id: 'file-b',
      filename: 'b.md',
      attributes: { title: 'Plans, part 2', url: 'https://e.com/plans' },
    },
    { file_id: 'file-c', filename: 'c.md', attributes: { title: 'Internal notes' } },
  ]);

  it('maps a file_citation to the title and URL of the cited file', () => {
    expect(
      citationSource(
        { type: 'file_citation', file_id: 'file-a', filename: 'a.md', index: 3 },
        sources,
      ),
    ).toEqual({ key: 'url:https://e.com/plans', title: 'Plans', url: 'https://e.com/plans' });
  });

  it('gives files citing the same page one key, so they collapse into one source', () => {
    const a = citationSource({ type: 'file_citation', file_id: 'file-a' }, sources);
    const b = citationSource({ type: 'file_citation', file_id: 'file-b' }, sources);
    expect(a?.key).toBe(b?.key);
  });

  it('keys a file without a URL by its ID', () => {
    expect(citationSource({ type: 'file_citation', file_id: 'file-c' }, sources)).toEqual({
      key: 'file:file-c',
      title: 'Internal notes',
      url: undefined,
    });
  });

  it("falls back to the annotation's file name, then to a generic title", () => {
    expect(
      citationSource(
        { type: 'file_citation', file_id: 'file-x', filename: ' guide.pdf ' },
        sources,
      ),
    ).toEqual({ key: 'file:file-x', title: 'guide.pdf', url: undefined });
    expect(
      citationSource({ type: 'file_citation', file_id: 'file-y', filename: '' }, sources),
    ).toEqual({ key: 'file:file-y', title: 'Document', url: undefined });
    expect(citationSource({ type: 'file_citation', file_id: 'file-z' }, sources)?.title).toBe(
      'Document',
    );
  });

  it('ignores a file_citation without a string file ID', () => {
    expect(citationSource({ type: 'file_citation' }, sources)).toBeUndefined();
    expect(citationSource({ type: 'file_citation', file_id: 42 }, sources)).toBeUndefined();
  });

  it('maps a url_citation with an http(s) link, titled by the link when untitled', () => {
    expect(
      citationSource({ type: 'url_citation', url: 'https://e.com/a', title: ' A page ' }, sources),
    ).toEqual({ key: 'url:https://e.com/a', title: 'A page', url: 'https://e.com/a' });
    expect(citationSource({ type: 'url_citation', url: 'https://e.com/b' }, sources)).toEqual({
      key: 'url:https://e.com/b',
      title: 'https://e.com/b',
      url: 'https://e.com/b',
    });
  });

  it('drops a url_citation whose link is not http(s)', () => {
    expect(
      citationSource({ type: 'url_citation', url: 'javascript:alert(1)', title: 'x' }, sources),
    ).toBeUndefined();
    expect(citationSource({ type: 'url_citation', url: 42 }, sources)).toBeUndefined();
  });

  it('ignores unknown annotation types and non-objects', () => {
    expect(
      citationSource({ type: 'container_file_citation', file_id: 'file-a' }, sources),
    ).toBeUndefined();
    expect(citationSource({ file_id: 'file-a' }, sources)).toBeUndefined();
    expect(citationSource(null, sources)).toBeUndefined();
    expect(citationSource('file_citation', sources)).toBeUndefined();
  });
});

describe('mergeRepeatedMarkers', () => {
  const cited = (index: number): boolean => index <= 2;

  it('merges a marker repeated right after itself, with or without spaces', () => {
    expect(mergeRepeatedMarkers('Pixel. [1] [1] Fridays.[2][2]\t[2]', cited)).toBe(
      'Pixel. [1] Fridays.[2]',
    );
  });

  it('keeps different markers, markers apart, and numbers that are no citation', () => {
    expect(mergeRepeatedMarkers('A [1][2] B [1] and [1]\n[1] grid[3][3]', cited)).toBe(
      'A [1][2] B [1] and [1]\n[1] grid[3][3]',
    );
  });
});

describe('MarkerMerger', () => {
  const stream = (deltas: readonly string[]): string[] => {
    const merger = new MarkerMerger((index) => index === 1);
    const sent = deltas.map((delta) => merger.push(delta));
    return [...sent, merger.flush()];
  };

  it('merges a repeat that arrives in a later delta, however the deltas split it', () => {
    const text = 'Pixel. [1] [1] Fridays [1][1].';
    for (let a = 1; a < text.length; a += 1) {
      for (let b = a; b < text.length; b += 1) {
        const deltas = [text.slice(0, a), text.slice(a, b), text.slice(b)];
        expect(stream(deltas).join('')).toBe('Pixel. [1] Fridays [1].');
      }
    }
  });

  it('sends text at once and holds only what could still become a repeat', () => {
    expect(stream(['Pixel [1]', ' ', '[', '1] visits', ' [', 'a link](x)'])).toEqual([
      'Pixel [1]',
      '',
      '',
      ' visits',
      ' ',
      '[a link](x)',
      '',
    ]);
  });

  it('releases held text at the end of the stream', () => {
    expect(stream(['Pixel [1] ', '['])).toEqual(['Pixel [1]', '', ' [']);
  });
});
