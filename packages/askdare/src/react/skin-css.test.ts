import { describe, expect, it } from 'vitest';
import css from './skin/askdare.css?raw';

// Inside a page, the skin shares the document with the site: no rule may reach outside the chat
// (ADR-0011). Every selector starts at a part or at the theme root, and none names the document.

/** The selector lists of every style rule, outside @keyframes. */
function selectorLists(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const lists: string[] = [];
  let depth = 0;
  let keyframesDepth: number | undefined;
  let buffer = '';
  for (const char of text) {
    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      depth += 1;
      if (prelude.startsWith('@')) {
        if (prelude.startsWith('@keyframes')) keyframesDepth = depth;
      } else if (keyframesDepth === undefined) {
        lists.push(prelude);
      }
    } else if (char === '}') {
      if (keyframesDepth === depth) keyframesDepth = undefined;
      depth -= 1;
      buffer = '';
    } else if (char === ';') {
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return lists;
}

/** Splits a selector list at its top-level commas, not those inside :is() or :where(). */
function split(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts.map((part) => part.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'));
}

const selectors = selectorLists(css).flatMap(split);
const SCOPED =
  /^(?:\[data-ask-part=|\[data-askdare-root\]|:is\(\[data-ask-part=|:where\(\[data-ask(?:-part=|dare-root\]))/;

describe('the skin stylesheet', () => {
  it('has rules to check', () => {
    expect(selectors.length).toBeGreaterThan(200);
  });

  it('never styles the document itself', () => {
    const offending = selectors.filter(
      (selector) => selector.includes(':root') || /(?:^|[\s>+~(,])(?:html|body)\b/.test(selector),
    );
    expect(offending).toEqual([]);
  });

  it('starts every selector at a part or at the theme root', () => {
    expect(selectors.filter((selector) => !SCOPED.test(selector))).toEqual([]);
  });

  it('keeps global rules without specificity', () => {
    const global = selectors.filter((selector) =>
      /^:where\(\[data-askdare-root\](?:,|\))/.test(selector),
    );
    expect(global.length).toBeGreaterThan(0);
  });
});
