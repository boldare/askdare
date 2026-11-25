import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Lexer } from 'marked';
import { describe, expect, it } from 'vitest';
import { lexerOnlyMarked } from '../scripts/marked-lexer-only';

// The React build cuts marked down to its classes (scripts/marked-lexer-only.ts). This runs the
// cut on the installed marked and checks that its Lexer still reads markdown exactly as marked's.
const SAMPLES = [
  '# Title\n\nSome **bold**, _italic_, `code`, ~~gone~~ and [a link](https://example.com).',
  '- a\n- [ ] task\n  - nested\n\n1. one\n2. two\n\n> quote\nlazy line',
  '```js\nlet x = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',
  '<b>html</b> &amp; &#169; ![image](x.png) www.example.com mail@example.com\n\n---\nline  \nbreak',
  '[ref]: https://example.com\n\n[ref] and [text][ref]',
  '*'.repeat(60),
  '',
];

describe('marked, cut to its lexer', () => {
  it('keeps the Lexer, which reads markdown exactly as before, and drops marked()', async () => {
    const file = createRequire(import.meta.url).resolve('marked');
    const cut = lexerOnlyMarked(await readFile(file, 'utf8'));
    const module = (await import(
      `data:text/javascript;base64,${Buffer.from(cut).toString('base64')}`
    )) as Record<string, unknown> & { Lexer: typeof Lexer };
    expect(Object.keys(module)).toContain('Lexer');
    expect(Object.keys(module)).not.toContain('marked');
    expect(Object.keys(module)).not.toContain('parse');
    for (const sample of SAMPLES) {
      expect(module.Lexer.lex(sample)).toEqual(Lexer.lex(sample));
    }
  });

  it('fails the build when marked no longer has the expected shape', () => {
    expect(() => lexerOnlyMarked('export{a as Lexer};')).toThrow(/marked-lexer-only/);
  });
});
