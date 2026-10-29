import type OpenAI from 'openai';
import type { TurnRequest, TurnResult } from '../gateway';
import type { MessageEndReason } from '../protocol/events';
import { fromOpenAIError } from './errors';
import { CitationRegistry, ResponseStreamMapper, type StepOutcome } from './stream-mapper';

function isDeadline(signal: AbortSignal): boolean {
  return (
    signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
  );
}

function endReason(outcome: StepOutcome): MessageEndReason {
  if (outcome.status === 'completed') return 'completed';
  if (outcome.incompleteReason === 'max_output_tokens') return 'max_output_tokens';
  if (outcome.incompleteReason === 'content_filter') return 'content_filter';
  return 'completed';
}

/**
 * Runs one chat turn against the Responses API, appending to the OpenAI conversation and streaming
 * mapped protocol events through `request.emit`. All request parameters are server-controlled.
 */
export async function runTurn(client: OpenAI, request: TurnRequest): Promise<TurnResult> {
  const { bot } = request;
  try {
    const stream = await client.responses.create(
      {
        model: bot.model,
        instructions: bot.instructions(request.context),
        input: [{ role: 'user', content: request.text }],
        conversation: request.conversationId,
        store: true,
        stream: true,
        max_output_tokens: bot.limits.maxOutputTokens,
        truncation: 'auto',
        safety_identifier: request.safetyIdentifier,
        prompt_cache_key: `chatdock:${bot.id}`,
      },
      { signal: request.signal },
    );
    const mapper = new ResponseStreamMapper(
      request.messageId,
      request.emit,
      new CitationRegistry(),
    );
    for await (const event of stream) mapper.handle(event);
    // The SDK ends iteration quietly when the signal aborts, so check it explicitly.
    if (request.signal.aborted) throw request.signal.reason;
    const outcome = mapper.outcome();
    return { reason: endReason(outcome), usage: outcome.usage };
  } catch (error) {
    throw fromOpenAIError(error, isDeadline(request.signal));
  }
}
