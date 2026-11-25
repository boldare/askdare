import { expect } from 'vitest';
import type { RepliesReader, UiReader } from '../../gateway';
import type { HistoryMessage } from '../../protocol/history';
import { guardNote } from '../guard-notes';
import { historyFromItems } from '../history';
import type { StoredItem } from '../port';
import type {
  HistoryPage,
  HistoryPosition,
  HistoryReader,
  HistoryRequest,
} from '../provider-history';

type Verdict = 'allowed' | 'withheld' | 'replaced';

const message = (
  id: string,
  role: 'user' | 'assistant' | 'developer',
  text: string,
  phase?: 'commentary',
): StoredItem => ({
  id,
  type: 'message',
  role,
  ...(phase ? { phase } : {}),
  parts: [{ type: 'text', text }],
});

/**
 * A conversation long enough to page through (ADR-0024, decision 7), with deterministic IDs:
 * `itm_u<n>` asks, `itm_a<n>` answers, and the turns differ in shape. Every third turn calls a
 * tool twice after a commentary; every seventh calls it 45 times, so it is longer than half a page
 * and crosses a page's edge. Each answer is settled by a guardrail note: every fifth withheld,
 * every fourth replaced by `itm_r<n>`, the others allowed.
 */
export function longConversation(turns: number): StoredItem[] {
  const items: StoredItem[] = [];
  for (let turn = 1; turn <= turns; turn += 1) {
    items.push(message(`itm_u${turn}`, 'user', `Question ${turn}`));
    const calls = turn % 7 === 0 ? 45 : turn % 3 === 0 ? 2 : 0;
    if (calls > 0)
      items.push(message(`itm_c${turn}`, 'assistant', `Looking ${turn}`, 'commentary'));
    for (let call = 1; call <= calls; call += 1) {
      const callId = `call_${turn}_${call}`;
      items.push(
        { id: `itm_f${turn}_${call}`, type: 'call', callId, name: 'find_slots', arguments: '{}' },
        { id: `itm_o${turn}_${call}`, type: 'call_output', callId, output: `{"slot":${call}}` },
      );
    }
    items.push(message(`itm_a${turn}`, 'assistant', `Answer ${turn}`));
    const verdict: Verdict = turn % 5 === 0 ? 'withheld' : turn % 4 === 0 ? 'replaced' : 'allowed';
    items.push(message(`itm_n${turn}`, 'developer', guardNote(verdict)));
    if (verdict === 'replaced')
      items.push(message(`itm_r${turn}`, 'assistant', `Replaced ${turn}`));
  }
  return items;
}

/** A card per call, for checking that each answer carries its own turn's cards. */
export const cardPerCall: UiReader = (calls) =>
  calls.flatMap((call) =>
    call.callId === undefined
      ? []
      : [{ callId: call.callId, name: call.name, data: { output: call.output ?? null } }],
  );

/** The same options after every answer, for checking that only the latest one has them. */
export const alwaysOffer: RepliesReader = () => ['Yes', 'No'];

/** Every history page through a reader, newest first. */
export async function readEveryPage(
  read: HistoryReader,
  id: string,
  request: HistoryRequest,
): Promise<HistoryPage[]> {
  const pages: HistoryPage[] = [];
  let before: HistoryPosition | undefined;
  do {
    const page = await read(id, { ...request, before });
    pages.push(page);
    before = page.next;
    if (pages.length > 100) throw new Error('paging never ended');
  } while (before);
  return pages;
}

/**
 * The checks every store's history paging passes: the pages read together show exactly what the
 * whole conversation read at once shows, with options on the latest answer only.
 */
export async function expectWholeTurnPages(
  read: HistoryReader,
  id: string,
  stored: readonly StoredItem[],
): Promise<void> {
  for (const checked of [false, true]) {
    const request = { replies: alwaysOffer, ui: cardPerCall, checked };
    const pages = await readEveryPage(read, id, request);
    expect(pages.length).toBeGreaterThan(2);
    const messages: HistoryMessage[] = pages.toReversed().flatMap((page) => page.messages);
    // Every turn once, cards per answer and settled answers as in the whole conversation.
    expect(messages).toEqual(historyFromItems(stored, request));
    for (const page of pages) expect(page.messages[0]?.role).toBe('user');
    // Options on the latest answer only.
    expect(messages.filter((message) => message.replies)).toEqual([messages.at(-1)]);
    expect(messages.some((message) => message.ui)).toBe(true);
  }
}
