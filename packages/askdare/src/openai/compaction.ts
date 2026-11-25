import type OpenAI from 'openai';
import { toResponseInputItem } from 'openai/lib/responses/ResponseInputItems';
import type { ResponseCompactionItem } from 'openai/resources/responses/responses';
import { compactionStopped } from '../conversations/compaction';
import { contextWindow, newItemId } from '../conversations/items';
import { type StoredItem, VersionConflictError } from '../conversations/port';
import type { CompactionRequest, CompactionResult } from '../gateway';
import { ZERO_USAGE } from '../usage';
import { fromOpenAIError } from './errors';
import { guardedInstructions } from './guardrails';
import { compactionModel, promptCacheKey, replayInput } from './replay';
import { tokenUsage } from './stream-mapper';
import { responseTools } from './tools';

/**
 * The lowest `max_output_tokens` the API accepts with a `compaction_trigger` (400 below it, spike
 * S9, 2026-11-23; not in the guide). The summary itself is 1–2k tokens.
 */
export const COMPACTION_MAX_OUTPUT_TOKENS = 20_000;

/** How long a compaction request may take; S9 measured 14–16 s at 80–115k tokens. */
export const COMPACTION_TIMEOUT_MS = 60_000;

/**
 * Compacts a conversation in an item store after a turn (ADR-0029): one stateless request with
 * the replayed window followed by `compaction_trigger`, with the turn's model, instructions,
 * tools and cache key, so it reads the prompt cache the turn just wrote. The compaction item is
 * appended at the version the turn left; a conflict drops it.
 */
export async function compactConversation(
  client: OpenAI,
  request: CompactionRequest,
): Promise<CompactionResult> {
  const { bot, conversations, conversationId, signal } = request;
  const model = compactionModel(bot.model);
  const context = await conversations.context(conversationId, { model, signal });
  if (context.kind !== 'items') return { outcome: 'skipped', usage: ZERO_USAGE };
  // Anything written since the turn belongs to a turn that the compaction would race.
  if (context.version !== request.version) return { outcome: 'conflict', usage: ZERO_USAGE };
  // Again here, for a custom store that ignores `model`.
  const items = contextWindow(context.items, { model });
  if (compactionStopped(items)) return { outcome: 'skipped', usage: ZERO_USAGE };

  const tools = responseTools(bot);
  const response = await client.responses
    .create(
      {
        model: bot.model,
        instructions: guardedInstructions(bot, bot.instructions(request.context)),
        input: [...replayInput(items, model.family), { type: 'compaction_trigger' }],
        // Nothing of the conversation stays at OpenAI, as in the turn (ADR-0024).
        store: false,
        max_output_tokens: COMPACTION_MAX_OUTPUT_TOKENS,
        safety_identifier: request.safetyIdentifier,
        prompt_cache_key: promptCacheKey(bot),
        // The turn's tools, so the prompt starts as the turn's did and the cache holds (S9).
        ...(tools.length > 0
          ? { tools, tool_choice: 'auto' as const, parallel_tool_calls: true }
          : {}),
      },
      { signal, timeout: COMPACTION_TIMEOUT_MS, maxRetries: 0 },
    )
    // As in a turn: what OpenAI says goes to logs and onError redacted, since it may quote the
    // conversation.
    .catch((error: unknown) => {
      throw fromOpenAIError(error, signal.aborted);
    });
  const usage = tokenUsage(response.usage);
  const output = response.output.find(
    (item): item is ResponseCompactionItem => item.type === 'compaction',
  );
  const data = output ? toResponseInputItem(output) : undefined;
  if (!data) return { outcome: 'failed', usage };
  const item: StoredItem = {
    id: newItemId(),
    type: 'native',
    provider: model.provider,
    family: model.family,
    kind: 'compaction',
    data,
  };
  try {
    await conversations.append(conversationId, [item], { expect: request.version, signal });
  } catch (error) {
    // The visitor wrote again while it ran: their turn replayed the full window, and the next
    // turn may compact again (ADR-0029, decision 4).
    if (error instanceof VersionConflictError) return { outcome: 'conflict', usage };
    throw error;
  }
  return { outcome: 'compacted', usage };
}
