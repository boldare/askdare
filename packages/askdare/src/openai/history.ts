import type OpenAI from 'openai';
import type { ConversationItem } from 'openai/resources/conversations/items';
import type { RepliesReader, StoredCall, UiReader } from '../gateway';
import type { HistoryCitation, HistoryMessage } from '../protocol/history';
import { normalizeReplies } from '../protocol/replies';
import { isToolUiList, MAX_TOOL_UI, type ToolUi } from '../protocol/tool-ui';
import { addSources, citationSource, type KnowledgeSources } from './citations';
import { readGuardNote, unwrapToolOutput } from './guardrails';
import { PAGE_CONTEXT_MARKER } from './page-context';
import { isFailedOutput } from './tools';

/** Most recent items fetched per history request; older ones are not shown. */
const ITEM_LIMIT = 100;

function citationsOf(
  annotations: readonly unknown[],
  sources: KnowledgeSources,
): HistoryCitation[] {
  const citations: HistoryCitation[] = [];
  const seen = new Set<string>();
  for (const annotation of annotations) {
    const source = citationSource(annotation, sources);
    if (!source || seen.has(source.key)) continue;
    seen.add(source.key);
    citations.push({ index: citations.length + 1, title: source.title, url: source.url });
  }
  return citations;
}

/** Maps one stored item to a visible message; tool calls, reasoning and unknown items are skipped. */
export function toHistoryMessage(
  item: ConversationItem,
  sources: KnowledgeSources = new Map(),
): HistoryMessage | undefined {
  if (item.type !== 'message' || (item.role !== 'user' && item.role !== 'assistant'))
    return undefined;
  if (item.phase === 'commentary') return undefined;
  let text = '';
  let attachments = 0;
  const annotations: unknown[] = [];
  for (const part of item.content) {
    switch (part.type) {
      case 'input_text':
      case 'output_text':
        // The page's description travels in the visitor's turn but is not something they wrote.
        if (part.type === 'input_text' && part.text.startsWith(PAGE_CONTEXT_MARKER)) break;
        text += part.text;
        if (part.type === 'output_text') annotations.push(...part.annotations);
        break;
      case 'refusal':
        text += part.refusal;
        break;
      case 'input_image':
      case 'input_file':
        attachments += 1;
        break;
      default:
        break;
    }
  }
  if (text === '' && attachments === 0) return undefined;
  return {
    id: item.id,
    role: item.role,
    text,
    citations: citationsOf(annotations, sources),
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
  oldestFirst: readonly ConversationItem[],
  sources: KnowledgeSources,
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
  const close = (): void => {
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
    const note = readGuardNote(item);
    if (note) {
      settle(note === 'allowed');
      if (note !== 'allowed') {
        turn.plain = false;
        replacing = note === 'replaced';
      }
      continue;
    }
    if (item.type === 'function_call_output' && item.call_id && typeof item.output === 'string') {
      const output = unwrapToolOutput(item.output);
      if (!isFailedOutput(output)) outputs.set(item.call_id, output);
    } else if (item.type === 'function_call') {
      pending.push({ name: item.name, arguments: item.arguments, callId: item.call_id });
    }
    const message = toHistoryMessage(item, sources);
    if (!message) continue;
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
 * Reads the visible part of a conversation, oldest first. Spike S1 measured about 2 s per call,
 * so clients load it once when the widget opens, not on every turn.
 */
export async function listHistory(
  client: OpenAI,
  conversationId: string,
  signal?: AbortSignal,
  replies?: RepliesReader,
  ui?: UiReader,
  checked = false,
): Promise<HistoryMessage[]> {
  const page = await client.conversations.items.list(
    conversationId,
    // Search results carry the titles and URLs that file citations link to.
    { order: 'desc', limit: ITEM_LIMIT, include: ['file_search_call.results'] },
    signal ? { signal } : undefined,
  );
  const oldestFirst = page.data.toReversed();
  const sources: KnowledgeSources = new Map();
  // Oldest first, so the newest search results win when a file was retagged in between.
  for (const item of oldestFirst) {
    if (item.type === 'file_search_call') addSources(item, sources);
  }
  const { messages, turns } = readTurns(oldestFirst, sources, checked);
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
