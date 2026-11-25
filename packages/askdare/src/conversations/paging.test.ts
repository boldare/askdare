import { describe, expect, it } from 'vitest';
import { HISTORY_ITEMS, itemHistory, pageOfTurns, type RawPage } from './history';
import { memoryConversations } from './memory';
import type { HistoryPosition } from './provider-history';
import { expectWholeTurnPages, longConversation, readEveryPage } from './testing/long-conversation';

/** A store page reader over numbers, newest last, whose cursor is the oldest index returned. */
function numbers(all: readonly number[]) {
  const reads: { before: string | undefined; limit: number }[] = [];
  const read = async (before: string | undefined, limit: number): Promise<RawPage<number>> => {
    reads.push({ before, limit });
    const end = before === undefined ? all.length : Number(before);
    const start = Math.max(0, end - limit);
    return { items: all.slice(start, end), before: start > 0 ? String(start) : undefined };
  };
  return { read, reads };
}

/** Every page of a conversation, newest page first, as a client scrolling back reads them. */
async function everyPage<Item>(
  readPage: (from: HistoryPosition | undefined) => Promise<{
    readonly items: readonly Item[];
    readonly next?: HistoryPosition | undefined;
  }>,
): Promise<(readonly Item[])[]> {
  const pages: (readonly Item[])[] = [];
  let from: HistoryPosition | undefined;
  do {
    const page = await readPage(from);
    pages.push(page.items);
    from = page.next;
    if (pages.length > 100) throw new Error('paging never ended');
  } while (from);
  return pages;
}

/** Turns of the given lengths; a turn starts at a multiple of 1000. */
const turnsOf = (lengths: readonly number[]): number[] =>
  lengths.flatMap((length, turn) =>
    Array.from({ length }, (_, index) => (turn + 1) * 1000 + index),
  );
const startsTurn = (item: number): boolean => item % 1000 === 0;

describe('pageOfTurns', () => {
  it('returns every item once, in order, and starts each page at a turn', async () => {
    // Short turns, turns across a page's edge, one longer than a page, exactly a page.
    for (const lengths of [
      [3, 4, 5],
      Array.from({ length: 60 }, (_, turn) => (turn % 7) + 1),
      [2, 150, 3, 4, 90, 7, 7, 7],
      [HISTORY_ITEMS, HISTORY_ITEMS, 1],
      [1, ...Array.from({ length: 40 }, () => 99)],
    ]) {
      const all = turnsOf(lengths);
      const { read } = numbers(all);
      const pages = await everyPage((from) => pageOfTurns(read, startsTurn, from));
      expect(pages.toReversed().flat()).toEqual(all);
      for (const page of pages) expect(startsTurn(page[0] ?? -1)).toBe(true);
      expect(pages.every((page) => page.length > 0)).toBe(true);
    }
  });

  it('keeps items before the first turn on the oldest page', async () => {
    const all = [1, 2, ...turnsOf(Array.from({ length: 30 }, () => 9))];
    const { read } = numbers(all);
    const pages = await everyPage((from) => pageOfTurns(read, startsTurn, from));
    expect(pages.toReversed().flat()).toEqual(all);
    expect(pages.at(-1)?.slice(0, 3)).toEqual([1, 2, 1000]);
  });

  it('reads the latest page with no cursor, as clients without paging do', async () => {
    const all = turnsOf([5, 5]);
    const { read, reads } = numbers(all);
    expect(await pageOfTurns(read, startsTurn, undefined)).toEqual({ items: all });
    expect(reads).toEqual([{ before: undefined, limit: HISTORY_ITEMS }]);
  });

  it('reads past the items already shown, a full page more', async () => {
    const { read, reads } = numbers(turnsOf([50, 120, 30]));
    const latest = await pageOfTurns(read, startsTurn, undefined);
    expect(latest.next).toEqual({ before: '100', skip: 50 });
    await pageOfTurns(read, startsTurn, latest.next);
    expect(reads.at(-1)).toEqual({ before: '100', limit: HISTORY_ITEMS + 50 });
  });

  it('gives up on a turn longer than eight store pages and shows it split', async () => {
    const all = turnsOf([5, 2000]);
    const { read, reads } = numbers(all);
    const page = await pageOfTurns(read, startsTurn, undefined);
    expect(reads).toHaveLength(8);
    expect(page.items).toHaveLength(800);
    expect(page.next).toBeDefined();
    const pages = await everyPage((from) => pageOfTurns(read, startsTurn, from));
    expect(pages.toReversed().flat()).toEqual(all);
  });
});

describe('itemHistory: pages of whole turns (ADR-0024, decision 7)', () => {
  const stored = longConversation(41);

  it('pages through a whole conversation of an item store', async () => {
    const store = memoryConversations();
    const id = await store.create({ botId: 'support', owner: 'visitor:v' });
    await store.append(id, stored);
    expect(stored.length).toBeGreaterThan(3 * HISTORY_ITEMS);
    await expectWholeTurnPages(itemHistory(store), id, stored);
  });

  it('shows settled answers only, with their replacements, under output checks', async () => {
    const store = memoryConversations();
    const id = await store.create({ botId: 'support', owner: 'visitor:v' });
    await store.append(id, stored);
    const pages = await readEveryPage(itemHistory(store), id, { checked: true });
    const ids = pages.toReversed().flatMap((page) => page.messages.map((message) => message.id));
    expect(ids).toContain('itm_a1');
    expect(ids).not.toContain('itm_a5');
    expect(ids).not.toContain('itm_a8');
    expect(ids).toContain('itm_r8');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
