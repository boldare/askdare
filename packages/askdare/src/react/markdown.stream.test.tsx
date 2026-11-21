// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import type { Token } from 'marked';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from './markdown';

// Counts the work each delta costs: characters marked lexes, and top-level blocks rendered (each
// render reads its token's `type` once).
const work = vi.hoisted(() => ({ lexed: 0, reads: 0 }));

vi.mock('marked', async (importOriginal) => {
  const marked = await importOriginal<typeof import('marked')>();
  // `Markdown` only calls `Lexer.lex`.
  const Lexer = {
    lex(src: string, options?: Parameters<typeof marked.Lexer.lex>[1]) {
      work.lexed += src.length;
      const tokens = marked.Lexer.lex(src, options);
      tokens.forEach((token, index) => {
        tokens[index] = new Proxy(token, {
          get(target, key, receiver) {
            if (key === 'type') work.reads++;
            return Reflect.get(target, key, receiver);
          },
        }) as Token;
      });
      return tokens;
    },
  };
  return { ...marked, Lexer };
});

afterEach(cleanup);

/** Renders `text` in one go, as a finished answer. */
const whole = (text: string): string => {
  const { container, unmount } = render(<Markdown text={text} />);
  const html = container.innerHTML;
  unmount();
  return html;
};

/** Streams `text` in deltas of `size` characters, calling `each` after every delta. */
function stream(text: string, size: number, each: (sofar: string, html: string) => void): void {
  const { container, rerender } = render(<Markdown text="" />);
  for (let end = size; end < text.length + size; end += size) {
    const sofar = text.slice(0, end);
    act(() => rerender(<Markdown text={sofar} />));
    each(sofar, container.innerHTML);
  }
}

// Cases where text appended later changes how earlier text parses.
const TRICKY = [
  'A paragraph\nthat becomes a heading\n===\n\nand one more\n---\n\ndone',
  '- one\n- two\n\n- now loose\n\n  continued in the item\n\nafter the list',
  '1. first\n2. second\n\n3. third\n\nend',
  '> a quote\nlazily continued\n> and more\n\nafter',
  'Intro\n| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |\n\nAfter the table',
  '```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nText after code\n\n    indented code\n\nend',
  'See [the docs][docs] and [more].\n\nMiddle paragraph.\n\n[docs]: https://example.com/docs\n[more]: https://example.com/more\n\nLast',
  '- [ ] task\n- [x] done\n\n***\n\n<div>html block\n\nstill</div>\n\nend <b>inline</b>',
  'Text with &amp; entities &copy;\nand a hard  \nbreak, **bold _nested_ text** and `code`.\n\n# Heading\n\n## Sub',
  '    indented\n\n    still code\n\n> one quote\n\n> another\n\n- a\n\n\n- b\n\n1) x\n\n2) y',
  '* a\n  * b\n    * c\n\n      deep paragraph\n\n* d',
];

describe('Markdown while streaming', () => {
  it.each(TRICKY)('renders every prefix exactly as a fresh render would: %j', (text) => {
    stream(text, 1, (sofar, html) => {
      expect(html, JSON.stringify(sofar)).toBe(whole(sofar));
    });
  });

  it('keeps up when the text is replaced instead of extended', () => {
    const { container, rerender } = render(<Markdown text={'# One\n\ntext'} />);
    rerender(<Markdown text={'- two\n- three'} />);
    expect(container.innerHTML).toBe(whole('- two\n- three'));
  });

  it('does constant work per delta, however long the answer grows', () => {
    const section = (n: number) =>
      `## Section ${n}\n\nSome **bold** text, \`code\` and a [link](https://example.com/${n}).\n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| ${n} | x |\n\n\`\`\`\ncode ${n}\n\`\`\`\n\n> quoted ${n}\n\n`;
    let text = '';
    for (let n = 0; text.length < 20_000; n++) text += section(n);
    const perDelta: { lexed: number; reads: number }[] = [];

    // A 20 KB answer in 1,000 deltas.
    stream(text, Math.floor(text.length / 1000), () => {
      perDelta.push({ ...work });
      work.lexed = 0;
      work.reads = 0;
    });

    expect(perDelta.length).toBeGreaterThanOrEqual(1000);
    const deltas = perDelta.slice(1);
    // Only the last few blocks are lexed again, never the whole answer…
    const longest = section(999).length;
    for (const { lexed } of deltas) expect(lexed).toBeLessThan(2 * longest);
    // …and only they render again: the last deltas cost no more than the first ones.
    const tenth = Math.floor(deltas.length / 10);
    const mostReads = (part: typeof deltas) => Math.max(...part.map(({ reads }) => reads));
    expect(mostReads(deltas.slice(-tenth))).toBeLessThanOrEqual(mostReads(deltas.slice(0, tenth)));
    // It counts work rather than timing it; 1,000 React renders take ~3 s alone and more under a
    // full parallel run, so it gets more than the default 5 s.
  }, 30_000);
});
