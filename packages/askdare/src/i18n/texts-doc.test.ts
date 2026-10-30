import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderTexts, replaceGenerated, TEXTS_DOC, UPDATE_COMMAND } from '../../scripts/docs-texts';
import * as texts from './texts';

describe('docs/texts.md', () => {
  it('lists every text key with its current defaults', async () => {
    const page = await readFile(TEXTS_DOC, 'utf8');
    expect(page, `docs/texts.md is out of date. Run: ${UPDATE_COMMAND}`).toBe(
      replaceGenerated(page, renderTexts(texts)),
    );
  });

  it('escapes table syntax and keeps plural categories together', () => {
    const plural = ['zero', 'one', 'two', 'few', 'many', 'other'].map((form) => `n.files.${form}`);
    const table = renderTexts({
      TEXT_LOCALES: ['en'],
      TEXT_KEYS: ['n.files.one', 'a.pipe', ...plural],
      textsFor: () => ({
        'a.pipe': 'x | y\nz <b>',
        'n.files.one': '{count} file',
        'n.files.other': '{count} files',
      }),
    });
    expect(table).toContain('| `a.pipe` | x \\| y<br>z &lt;b> |');
    expect(table).toContain('| `n.files.zero` | — |');
    expect([...table.matchAll(/\| `([\w.]+)`/g)].map((match) => match[1])).toEqual([
      ...plural,
      'a.pipe',
    ]);
  });

  it('keeps the text around the markers', () => {
    const page =
      'Intro\n<!-- BEGIN:generated-texts -->\nold\n<!-- END:generated-texts -->\nOutro\n';
    expect(replaceGenerated(page, 'new')).toBe(
      'Intro\n<!-- BEGIN:generated-texts -->\nnew\n<!-- END:generated-texts -->\nOutro\n',
    );
    expect(() => replaceGenerated('no markers', 'new')).toThrow(/BEGIN:generated-texts/);
  });
});
