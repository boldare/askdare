import type { StoredItem, StoredPart } from './port';

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
 * The latest `maxItems` items, moved forward to a visitor message so a turn is never cut in half:
 * a call without its output breaks the next model call (spike S1).
 */
export function replayWindow<T extends StoredItem>(items: readonly T[], maxItems: number): T[] {
  if (items.length <= maxItems) return [...items];
  let start = items.length - maxItems;
  for (; start < items.length; start += 1) {
    const item = items[start];
    if (item?.type === 'message' && item.role === 'user') break;
  }
  return items.slice(start);
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
