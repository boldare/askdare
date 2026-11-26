import type { CompactionModel, StoredItem, StoredPart } from './port';

/** A new item ID, unique enough within a conversation. */
export function newItemId(): string {
  return `itm_${crypto.randomUUID().replaceAll('-', '')}`;
}

/** The IDs of the files attached in visitor messages, each once. */
export function attachedFiles(items: Iterable<StoredItem>): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.type !== 'message' || item.role !== 'user') continue;
    for (const part of item.parts) if (part.type === 'file') ids.add(part.fileId);
  }
  return [...ids];
}

/**
 * Where the latest `maxItems` items start, moved forward to a visitor message so a turn is never
 * cut in half: a call without its output breaks the next model call (spike S1).
 */
function windowStart(items: readonly StoredItem[], maxItems: number): number {
  if (items.length <= maxItems) return 0;
  let start = Math.max(0, items.length - maxItems);
  for (; start < items.length; start += 1) {
    const item = items[start];
    if (item?.type === 'message' && item.role === 'user') break;
  }
  return start;
}

/** Whether an item is a compaction item that `model` can read (ADR-0029). */
export function isCompaction(item: StoredItem, model: CompactionModel): boolean {
  return (
    item.type === 'native' &&
    item.kind === 'compaction' &&
    item.provider === model.provider &&
    item.family === model.family
  );
}

/**
 * What `context()` returns of a conversation's items: from the latest compaction item of `model`,
 * or from the `maxItems` cut, whichever comes later (ADR-0024, ADR-0029). A compaction item is
 * written after a whole turn, so starting at it never splits one.
 */
export function contextWindow<T extends StoredItem>(
  items: readonly T[],
  options: { readonly maxItems?: number | undefined; readonly model?: CompactionModel | undefined },
): T[] {
  const { maxItems, model } = options;
  const cut = maxItems === undefined ? 0 : windowStart(items, maxItems);
  const compaction = model ? items.findLastIndex((item) => isCompaction(item, model)) : -1;
  return items.slice(Math.max(cut, compaction));
}

/** The visitor's turn as stored: the page's description, their text and their attached files. */
export function visitorItem(message: {
  readonly text: string;
  readonly pageContext?: string | undefined;
  readonly attachments?: readonly { readonly fileId: string; readonly kind: 'image' | 'pdf' }[];
}): StoredItem {
  const parts: StoredPart[] = [
    ...(message.pageContext ? [{ type: 'page_context' as const, text: message.pageContext }] : []),
    ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
    ...(message.attachments ?? []).map(
      ({ fileId, kind }): StoredPart => ({ type: 'file', fileId, kind }),
    ),
  ];
  return { id: newItemId(), type: 'message', role: 'user', parts };
}
