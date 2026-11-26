import { describe, expect, it } from 'vitest';
import { citedSourceIds, MARKER_HOLD_LIMIT, MarkerRewriter, rewriteMarkers } from './markers';

const A = 'k0123456789ab';
const B = 'kba9876543210';
const numbers: Record<string, number> = { [A]: 1, [B]: 2 };
const number = (id: string): number | undefined => numbers[id];

describe('knowledge markers', () => {
  it('finds the IDs a text cites, once each, in order', () => {
    expect(citedSourceIds(`x [${B}] y [${A}, ${B}] z [${A.toUpperCase()}]`)).toEqual([B, A]);
  });

  it('rewrites single, listed and repeated IDs, and drops unknown ones', () => {
    expect(
      rewriteMarkers(`a [${A}] b [${A}; ${B}] c [${A}, ${A}] d [kffffffffffff].`, number),
    ).toBe('a [1] b [1][2] c [1] d .');
  });

  it('leaves other brackets alone', () => {
    const text = 'grid[1][0], [k12], [a link](https://x.test), [k0123456789abc], [ ]';
    expect(rewriteMarkers(text, number)).toBe(text);
  });

  it('holds a marker split across deltas until it closes', async () => {
    const rewriter = new MarkerRewriter(async () => number);
    const out: string[] = [];
    for (const delta of ['Costs [', A.slice(0, 4), `${A.slice(4)}, `, `${B}`, '] each.']) {
      out.push(await rewriter.push(delta));
    }
    out.push(await rewriter.flush());
    expect(out).toEqual(['Costs ', '', '', '', '[1][2] each.', '']);
  });

  it('releases a bracket at once when it can no longer become a marker', async () => {
    const rewriter = new MarkerRewriter(async () => number);
    expect(await rewriter.push('See [the')).toBe('See [the');
    expect(await rewriter.push(' [')).toBe(' ');
    expect(await rewriter.push('x')).toBe('[x');
  });

  it(`gives up holding after ${MARKER_HOLD_LIMIT} characters`, async () => {
    const rewriter = new MarkerRewriter(async () => number);
    const long = `[${`${A}, `.repeat(9)}`;
    expect(long.length).toBeGreaterThanOrEqual(MARKER_HOLD_LIMIT);
    expect(await rewriter.push(long)).toBe(long);
  });

  it('rewrites a marker of several IDs split across deltas', async () => {
    const rewriter = new MarkerRewriter(async () => number);
    const ids = [A, B, A, B, A, B, A, B].join(', ');
    let out = '';
    for (const piece of ['x [', ids.slice(0, 40), ids.slice(40), '] y'])
      out += await rewriter.push(piece);
    out += await rewriter.flush();
    expect(out).toBe('x [1][2] y');
  });

  it('resolves only when a marker is complete, with every ID of the text at once', async () => {
    const asked: string[][] = [];
    const rewriter = new MarkerRewriter(async (ids) => {
      asked.push([...ids]);
      return number;
    });
    expect(await rewriter.push(`a [${A}] b [${B}] c [`)).toBe('a [1] b [2] c ');
    expect(await rewriter.push('nope]')).toBe('[nope]');
    expect(asked).toEqual([[A, B]]);
  });
});
