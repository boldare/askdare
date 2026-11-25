import { mergeRepeatedMarkers } from '../citation-markers';
import type { StoredCall, UiReader } from '../gateway';
import { rewriteMarkers } from '../knowledge/markers';
import { citationKey } from '../knowledge/passages';
import type { HistoryCitation, HistoryMessage } from '../protocol/history';
import { normalizeReplies } from '../protocol/replies';
import { isToolUiList, MAX_TOOL_UI, type ToolUi } from '../protocol/tool-ui';
import { isFailedOutput, unwrapToolOutput } from '../tools/outputs';
import { storedGuardNote } from './guard-notes';
import { storeFailure } from './owner';
import type { ConversationStore, StoredCitation, StoredItem } from './port';
import type { HistoryPosition, HistoryReader, HistoryRequest } from './provider-history';

/**
 * Items read per store page of history. A history page is about this many items, extended back to
 * the start of its oldest turn.
 */
export const HISTORY_ITEMS = 100;

/**
 * Store pages one history page reads at most. A turn longer than this (about 800 items, hundreds
 * of tool calls) is shown split rather than read without end: the newer page then starts inside
 * it. `maxSteps` keeps real turns far below it. docs/protocol.md names the exception.
 */
const MAX_READS = 8;

/** One store page, newest items last, and the cursor of the page before it. */
export interface RawPage<Item> {
  readonly items: readonly Item[];
  readonly before?: string | undefined;
}

/**
 * Reads one page of whole turns, oldest first: the newest store page before `from`, extended back
 * to the visitor message that starts its oldest turn, so a turn's cards, options and guardrail
 * notes are always read together (ADR-0024, decision 7). `read` returns the newest `limit` items
 * before a store cursor (a store may cap `limit`), the same ones each time for the same cursor:
 * stores are append-only. `next` is where the following older page ends; absent at the
 * conversation's start.
 */
export async function pageOfTurns<Item>(
  read: (before: string | undefined, limit: number) => Promise<RawPage<Item>>,
  startsTurn: (item: Item) => boolean,
  from: HistoryPosition | undefined,
): Promise<{ readonly items: readonly Item[]; readonly next?: HistoryPosition | undefined }> {
  const skip = from?.skip ?? 0;
  // A full page past the items already shown, where the store's own page limit allows it.
  let page = await read(from?.before, HISTORY_ITEMS + skip);
  let items = page.items.slice(0, Math.max(0, page.items.length - skip));
  const after = (before: string | undefined): HistoryPosition | undefined =>
    before === undefined ? undefined : { before, skip: 0 };
  for (let reads = 1; ; reads += 1) {
    const [oldest] = items;
    if (oldest !== undefined && startsTurn(oldest)) return { items, next: after(page.before) };
    const cursor = page.before;
    if (cursor === undefined) return { items };
    if (reads >= MAX_READS) return { items, next: after(cursor) };
    page = await read(cursor, HISTORY_ITEMS);
    const start = page.items.findLastIndex(startsTurn);
    if (start === -1) {
      items = [...page.items, ...items];
      continue;
    }
    items = [...page.items.slice(start), ...items];
    // The items older than the turn's start stay for the next page, read again from this cursor.
    return {
      items,
      next: start === 0 ? after(page.before) : { before: cursor, skip: page.items.length - start },
    };
  }
}

const startsStoredTurn = (item: StoredItem): boolean =>
  item.type === 'message' && item.role === 'user';

type StoredMessage = Extract<StoredItem, { type: 'message' }>;

/**
 * Maps one stored message to a visible message: visitors' and assistants' messages only, without
 * the page's description, with the citations stored on its text (ADR-0024, decision 8). An
 * answer's `[id]` markers of the bot's own index become `[n]` through the citations stored with
 * them, as they did while it streamed (ADR-0025); with `knowledge`, markers no citation resolves
 * are dropped, as they were then.
 */
export function historyMessage(item: StoredMessage, knowledge = false): HistoryMessage | undefined {
  if (item.role !== 'user' && item.role !== 'assistant') return undefined;
  let text = '';
  let attachments = 0;
  const citations: HistoryCitation[] = [];
  const numbers = new Map<string, number>();
  const add = (citation: StoredCitation): number => {
    const index = citations.length + 1;
    citations.push({ index, title: citation.title, url: citation.url });
    if (!numbers.has(citationKey(citation))) numbers.set(citationKey(citation), index);
    return index;
  };
  for (const part of item.parts) {
    switch (part.type) {
      case 'text': {
        const passages = new Map<string, StoredCitation>();
        for (const citation of part.citations ?? []) {
          if (citation.sourceId !== undefined) passages.set(citation.sourceId, citation);
        }
        if (item.role === 'assistant' && (knowledge || passages.size > 0)) {
          text += rewriteMarkers(part.text, (id) => {
            const citation = passages.get(id);
            if (!citation) return undefined;
            return numbers.get(citationKey(citation)) ?? add(citation);
          });
        } else {
          text += part.text;
        }
        // A part's file citations were told apart when they were stored, by the file they came
        // from, which two sources with the same title don't share: only another part's repeat one.
        const files = (part.citations ?? []).filter((citation) => citation.sourceId === undefined);
        const before = new Set(numbers.keys());
        for (const citation of files) {
          if (!before.has(citationKey(citation))) add(citation);
        }
        break;
      }
      case 'refusal':
        text += part.text;
        break;
      case 'file':
        attachments += 1;
        break;
      default:
        // The page's description travels in the visitor's turn but is not something they wrote.
        break;
    }
  }
  if (text === '' && attachments === 0) return undefined;
  return {
    id: item.id,
    role: item.role,
    // The same markers as the streamed answer showed.
    text: mergeRepeatedMarkers(text, (index) => index >= 1 && index <= citations.length),
    citations,
    attachments,
  };
}

/** One turn of the loaded page: its calls with their outputs, and its last visible answer. */
interface Turn {
  readonly calls: StoredCall[];
  /** Index in the messages, oldest first. */
  answer: number | undefined;
  /** False once a guardrail replaced or withheld its answer: it then offers no cards or options. */
  plain: boolean;
}

/**
 * Splits the items, oldest first, into turns at each visitor message, and maps the visible ones
 * to messages. A call that failed while running has no output, as in the live turn, where only
 * successful calls define options and payloads. The oldest turn may start before the page does.
 *
 * Guardrail notes (ADR-0022) settle the answers before them in their turn: `allowed` shows them,
 * `withheld` hides them, `replaced` hides them and shows the assistant message after the note.
 * With `checked` (bots with output checks), answers no note settled stay hidden: an answer
 * still being checked, or one whose check never finished, never shows.
 */
function readTurns(
  oldestFirst: readonly StoredItem[],
  checked: boolean,
  knowledge: boolean,
): { messages: HistoryMessage[]; turns: Turn[] } {
  const messages: HistoryMessage[] = [];
  const turns: Turn[] = [];
  const outputs = new Map<string, string>();
  const newTurn = (): Turn => ({ calls: [], answer: undefined, plain: true });
  let turn = newTurn();
  const hidden = new Set<number>();
  // The turn's answers since its last note, and whether the next answer is a replacement.
  let unsettled: number[] = [];
  let replacing = false;
  const settle = (show: boolean): void => {
    if (!show) for (const index of unsettled) hidden.add(index);
    unsettled = [];
  };
  const pending: { name: string; arguments: string; callId: string }[] = [];
  // Text marked as commentary that no later answer replaced: then it was the answer, written
  // before the reply options.
  let unanswered: HistoryMessage | undefined;
  // Makes that commentary the turn's answer, unsettled like any other, so a note or `checked`
  // decides whether it shows: a withheld or unchecked answer never does (ADR-0022).
  const promote = (): void => {
    if (unanswered && turn.answer === undefined) {
      messages.push(unanswered);
      turn.answer = messages.length - 1;
      unsettled.push(turn.answer);
    }
    unanswered = undefined;
  };
  const close = (): void => {
    promote();
    for (const call of pending) turn.calls.push({ ...call, output: outputs.get(call.callId) });
    pending.length = 0;
    settle(!checked);
    replacing = false;
    turns.push(turn);
  };
  for (const item of oldestFirst) {
    if (item.type === 'message' && item.role === 'user') {
      close();
      turn = newTurn();
    }
    const note = storedGuardNote(item);
    if (note) {
      promote();
      settle(note === 'allowed');
      if (note !== 'allowed') {
        turn.plain = false;
        replacing = note === 'replaced';
      }
      continue;
    }
    if (item.type === 'call_output') {
      const output = unwrapToolOutput(item.output);
      if (!isFailedOutput(output)) outputs.set(item.callId, output);
      continue;
    }
    if (item.type === 'call') {
      pending.push({ name: item.name, arguments: item.arguments, callId: item.callId });
      continue;
    }
    if (item.type !== 'message') continue;
    if (item.role === 'assistant' && item.phase === 'commentary') {
      unanswered = historyMessage(item, knowledge);
      continue;
    }
    const message = historyMessage(item, knowledge);
    if (!message) continue;
    if (message.role === 'assistant') unanswered = undefined;
    messages.push(message);
    if (message.role === 'assistant') {
      turn.answer = messages.length - 1;
      // The replacement is settled by the note before it.
      if (replacing) replacing = false;
      else unsettled.push(turn.answer);
    }
  }
  close();
  if (hidden.size === 0) return { messages, turns };
  // Indices shift once hidden answers go; a turn whose answer went has none.
  const kept: HistoryMessage[] = [];
  const moved = new Map<number, number>();
  for (const [index, message] of messages.entries()) {
    if (hidden.has(index)) continue;
    moved.set(index, kept.length);
    kept.push(message);
  }
  for (const each of turns) {
    each.answer = each.answer === undefined ? undefined : moved.get(each.answer);
  }
  return { messages: kept, turns };
}

/** The payloads a turn's calls define, within the limits; none when the reader fails. */
function turnUi(reader: UiReader, calls: readonly StoredCall[]): readonly ToolUi[] | undefined {
  if (calls.length === 0) return undefined;
  try {
    const ui = reader(calls).slice(0, MAX_TOOL_UI);
    return isToolUiList(ui) ? ui : undefined;
  } catch {
    // A reader that can't read its calls loses the cards, never the conversation.
    return undefined;
  }
}

/**
 * The visible part of stored items, oldest first: messages with their citations, each answer's
 * cards (ADR-0017), and the latest answer's options (ADR-0015). Provider-neutral: it reads the
 * stored items of any store, OpenAI's mapped through `fromConversationItem`.
 */
export function historyFromItems(
  oldestFirst: readonly StoredItem[],
  { replies, ui, checked = false, knowledge }: Omit<HistoryRequest, 'signal'>,
): HistoryMessage[] {
  const { messages, turns } = readTurns(oldestFirst, checked, knowledge !== undefined);
  // Every answer shows its turn's cards (ADR-0017).
  if (ui) {
    for (const { answer, calls, plain } of turns) {
      // A replaced answer shows no cards: they came from the turn the checks rejected.
      const message = answer === undefined || !plain ? undefined : messages[answer];
      const payloads = message && turnUi(ui, calls);
      if (answer !== undefined && message && payloads)
        messages[answer] = { ...message, ui: payloads };
    }
  }
  // Only the latest answer offers options, and only while the visitor hasn't replied yet.
  const latest = messages.at(-1);
  const last = turns.at(-1);
  if (replies && latest?.role === 'assistant' && last?.plain) {
    let items: readonly string[] | undefined;
    try {
      items = replies(last.calls);
    } catch {
      // A source that can't read its call loses the options, never the conversation.
      items = undefined;
    }
    const offered = items && normalizeReplies(items);
    if (offered) messages[messages.length - 1] = { ...latest, replies: offered };
  }
  return messages;
}

/**
 * The history reader of an item store: one page of whole turns, read with `page()`. A conversation
 * the store no longer has answers as one that belongs to someone else, so the two can't be told
 * apart.
 */
export function itemHistory(store: ConversationStore): HistoryReader {
  return async (conversationId, { signal, before, replies, ...request }) => {
    try {
      const { items, next } = await pageOfTurns(
        (cursor, limit) => store.page(conversationId, { before: cursor, limit, signal }),
        startsStoredTurn,
        before,
      );
      // Options belong to the latest answer, which only the latest page has.
      const messages = historyFromItems(items, {
        ...request,
        replies: before ? undefined : replies,
      });
      return next ? { messages, next } : { messages };
    } catch (error) {
      throw await storeFailure(store, conversationId, error, signal);
    }
  };
}
