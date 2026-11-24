/**
 * Stored items as in S7's `port.ts` (provider-neutral, plus `native` for opaque provider state),
 * extended with the checkpoint kinds this spike compares:
 * - a server-side `compaction` output item, stored as `native` (question 2);
 * - the window `/responses/compact` returns, stored as one `native` item (question 3);
 * - our own summary, stored as a neutral `summary` item (question 4).
 * The replay starts at the latest checkpoint this model family can use (ADR-0024's `maxItems`
 * window, cut at a checkpoint instead of a visitor message).
 */
import { randomBytes } from 'node:crypto';
import type { ResponseInputItem, ResponseOutputItem } from 'openai/resources/responses/responses';
import { toResponseInputItem } from 'openai/lib/responses/ResponseInputItems';

export type StoredItem =
  | { id: string; type: 'message'; role: 'user' | 'assistant' | 'developer'; phase?: 'commentary' | 'final_answer'; text: string }
  | { id: string; type: 'call'; callId: string; name: string; arguments: string }
  | { id: string; type: 'call_output'; callId: string; output: string }
  | { id: string; type: 'native'; provider: 'openai'; family: string; kind: 'reasoning' | 'compaction' | 'compacted_window' | 'other'; data: unknown }
  | { id: string; type: 'summary'; text: string; covers: number };

export const itemId = (): string => `itm_${randomBytes(9).toString('base64url')}`;

/** `gpt-6.1-terra` → `gpt-6.1` (S7). */
export const modelFamily = (model: string): string => model.replace(/-[a-z]+(-\d{4}-\d{2}-\d{2})?$/, '');

export const SUMMARY_PREFIX = 'Summary of the earlier part of this conversation (written by the assistant; the visitor\'s own words are quoted where they matter):\n';

function stripId<T>(value: T): T {
  if (value && typeof value === 'object' && 'id' in value) {
    const { id: _id, ...rest } = value as T & { id?: unknown };
    return rest as T;
  }
  return value;
}

/** Deterministic: the same item always renders to the same JSON (S7, ADR-0024 decision 3). */
export function toInputs(item: StoredItem, family: string): ResponseInputItem[] {
  switch (item.type) {
    case 'message':
      if (item.role === 'assistant') {
        return [{
          type: 'message', role: 'assistant', status: 'completed',
          ...(item.phase ? { phase: item.phase } : {}),
          content: [{ type: 'output_text', text: item.text, annotations: [] }],
        } as unknown as ResponseInputItem];
      }
      return [{ type: 'message', role: item.role, content: [{ type: 'input_text', text: item.text }] }];
    case 'call':
      return [{ type: 'function_call', call_id: item.callId, name: item.name, arguments: item.arguments }];
    case 'call_output':
      return [{ type: 'function_call_output', call_id: item.callId, output: item.output }];
    case 'summary':
      return [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: `${SUMMARY_PREFIX}${item.text}` }] }];
    case 'native':
      if (item.family !== family) return [];
      if (item.kind === 'compacted_window') return (item.data as ResponseInputItem[]).map(stripId);
      return [stripId(item.data as ResponseInputItem)];
  }
}

export function isCheckpoint(item: StoredItem, family: string): boolean {
  if (item.type === 'summary') return true;
  return item.type === 'native' && item.family === family && (item.kind === 'compaction' || item.kind === 'compacted_window');
}

/** The replay window: from the latest usable checkpoint on, or everything. */
export function window(items: readonly StoredItem[], family: string): StoredItem[] {
  const start = items.findLastIndex((item) => isCheckpoint(item, family));
  return start < 0 ? [...items] : items.slice(start);
}

export function replay(items: readonly StoredItem[], family: string): ResponseInputItem[] {
  return JSON.parse(JSON.stringify(window(items, family).flatMap((item) => toInputs(item, family)))) as ResponseInputItem[];
}

/** One output item of a stateless response, as stored. */
export function fromOutput(output: ResponseOutputItem, family: string): StoredItem | undefined {
  const id = itemId();
  switch (output.type) {
    case 'message':
      return {
        id, type: 'message', role: 'assistant', ...(output.phase ? { phase: output.phase } : {}),
        text: output.content.map((part) => (part.type === 'output_text' ? part.text : part.refusal)).join(''),
      };
    case 'function_call':
      return { id, type: 'call', callId: output.call_id, name: output.name, arguments: output.arguments };
    default: {
      const data = toResponseInputItem(output);
      if (!data) return undefined;
      const kind = output.type === 'reasoning' ? 'reasoning' : output.type === 'compaction' ? 'compaction' : 'other';
      return { id, type: 'native', provider: 'openai', family, kind, data };
    }
  }
}

/** Rough size of the stored items, for the report (no contents). */
export function describe(items: readonly StoredItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = item.type === 'native' ? `native:${item.kind}` : item.type === 'message' ? `message:${item.role}` : item.type;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
