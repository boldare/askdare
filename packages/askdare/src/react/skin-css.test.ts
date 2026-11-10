import { describe, expect, it } from 'vitest';
import css from './skin/askdare.css?raw';

// Inside a page, the skin shares the document with the site and maybe a headless chat: no rule may
// reach outside the default look (ADR-0011). Apart from the tokens on the theme root, every rule
// applies only inside [data-ask-skin], and none names the document.

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
/** Tokens and variants on the theme root, which a headless chat may use too. */
const TOKENS = /^\[data-askdare-root\](?:\[[^\]]+\])*$/;
/** The skin's own resets, from its root down, without specificity. */
const GLOBAL = /^:where\(\[data-ask-skin\][ ,)]/;
/** Any other rule: its subject must be inside the default look, before any pseudo-element. */
const INSIDE = /:where\(\[data-ask-skin\] \*\)(?:::[a-z-]+(?:\([^)]*\))?)?$/;

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

  it('applies every rule but the tokens only inside the default look', () => {
    const outside = selectors.filter(
      (selector) => !TOKENS.test(selector) && !GLOBAL.test(selector) && !INSIDE.test(selector),
    );
    expect(outside).toEqual([]);
  });

  it('styles parts of the default look only, not those of a headless chat', () => {
    const tokens = selectors.filter((selector) => TOKENS.test(selector));
    expect(tokens.every((selector) => !selector.includes('data-ask-part'))).toBe(true);
    expect(
      selectors.filter((selector) => selector.includes('data-ask-part')).length,
    ).toBeGreaterThan(150);
  });

  it('keeps global rules without specificity', () => {
    const global = selectors.filter((selector) =>
      /^:where\(\[data-ask-skin\](?:,|\))/.test(selector),
    );
    expect(global.length).toBeGreaterThan(0);
  });
});
