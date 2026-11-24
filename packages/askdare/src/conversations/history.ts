import { mergeRepeatedMarkers } from '../citation-markers';
import { AskdareError } from '../errors';
import type { StoredCall, UiReader } from '../gateway';
import type { HistoryCitation, HistoryMessage } from '../protocol/history';
import { normalizeReplies } from '../protocol/replies';
import { isToolUiList, MAX_TOOL_UI, type ToolUi } from '../protocol/tool-ui';
import { isFailedOutput, unwrapToolOutput } from '../tools/outputs';
import { storedGuardNote } from './guard-notes';
import { conversationGone } from './owner';
import type { ConversationStore, StoredCitation, StoredItem } from './port';
import type { HistoryReader, HistoryRequest } from './provider-history';

/** Most recent items read per history request; older ones are not shown (paging is task 3a). */
export const HISTORY_ITEMS = 100;

type StoredMessage = Extract<StoredItem, { type: 'message' }>;

/** Identity of a cited source within one message: the same page cited twice shows once. */
function citationKey(citation: StoredCitation): string {
  if (citation.sourceId !== undefined) return `source:${citation.sourceId}`;
  if (citation.url !== undefined) return `url:${citation.url}`;
  return `title:${citation.title}`;
}

/**
 * Maps one stored message to a visible message: visitors' and assistants' messages only, without
 * the page's description, with the citations stored on its text (ADR-0024, decision 8).
 */
export function historyMessage(item: StoredMessage): HistoryMessage | undefined {
  if (item.role !== 'user' && item.role !== 'assistant') return undefined;
  let text = '';
  let attachments = 0;
  const citations: HistoryCitation[] = [];
  const seen = new Set<string>();
  for (const part of item.parts) {
    switch (part.type) {
      case 'text':
        text += part.text;
        for (const citation of part.citations ?? []) {
          const key = citationKey(citation);
          if (seen.has(key)) continue;
          seen.add(key);
          citations.push({ index: citations.length + 1, title: citation.title, url: citation.url });
        }
        break;
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
  const close = (): void => {
    if (unanswered && turn.answer === undefined) {
      messages.push(unanswered);
      turn.answer = messages.length - 1;
    }
    unanswered = undefined;
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
      unanswered = historyMessage(item);
      continue;
    }
    const message = historyMessage(item);
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
  { replies, ui, checked = false }: Omit<HistoryRequest, 'signal'>,
): HistoryMessage[] {
  const { messages, turns } = readTurns(oldestFirst, checked);
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
 * The history reader of an item store: its latest items, read with `page()`. A conversation the
 * store doesn't know answers as one that belongs to someone else, so the two can't be told apart.
 */
export function itemHistory(store: ConversationStore): HistoryReader {
  return async (conversationId, { signal, ...request }) => {
    try {
      const page = await store.page(conversationId, { limit: HISTORY_ITEMS, signal });
      return historyFromItems(page.items, request);
    } catch (error) {
      if (error instanceof AskdareError && error.code === 'not_found') throw conversationGone();
      throw error;
    }
  };
}
