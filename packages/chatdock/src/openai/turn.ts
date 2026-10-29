import type OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import type { TokenUsage, TurnRequest, TurnResult } from '../gateway';
import type { MessageEndReason } from '../protocol/events';
import { fromOpenAIError } from './errors';
import { CitationRegistry, ResponseStreamMapper, type StepOutcome } from './stream-mapper';
import { danglingCallId, executeCalls, responseTools } from './tools';

/** Calls left without output by an earlier, aborted turn that one turn will repair. */
const MAX_REPAIRS = 3;

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

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

async function runStep(
  client: OpenAI,
  request: TurnRequest,
  input: ResponseInputItem[],
  citations: CitationRegistry,
  lastStep: boolean,
): Promise<StepOutcome> {
  const { bot } = request;
  const tools = responseTools(bot);
  const stream = await client.responses.create(
    {
      model: bot.model,
      instructions: bot.instructions(request.context),
      input,
      conversation: request.conversationId,
      // store:false would silently drop the turn from the conversation (spike S1, E10).
      store: true,
      stream: true,
      max_output_tokens: bot.limits.maxOutputTokens,
      truncation: 'auto',
      safety_identifier: request.safetyIdentifier,
      prompt_cache_key: `chatdock:${bot.id}`,
      ...(tools.length > 0
        ? { tools, tool_choice: lastStep ? 'none' : 'auto', parallel_tool_calls: true }
        : {}),
    },
    { signal: request.signal },
  );
  const mapper = new ResponseStreamMapper(request.messageId, request.emit, citations);
  for await (const event of stream) mapper.handle(event);
  // The SDK ends iteration quietly when the signal aborts, so check it explicitly.
  if (request.signal.aborted) throw request.signal.reason;
  return mapper.outcome();
}

/**
 * Runs one chat turn against the Responses API inside the OpenAI conversation: the model may call
 * the bot's tools for up to `maxSteps - 1` rounds, and the last step must answer in text.
 * All request parameters are server-controlled.
 */
export async function runTurn(client: OpenAI, request: TurnRequest): Promise<TurnResult> {
  const { bot } = request;
  const citations = new CitationRegistry();
  let usage: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let input: ResponseInputItem[] = [{ role: 'user', content: request.text }];
  let repairs = 0;
  try {
    for (let step = 1; step <= bot.limits.maxSteps; step += 1) {
      let outcome: StepOutcome;
      try {
        outcome = await runStep(client, request, input, citations, step === bot.limits.maxSteps);
      } catch (error) {
        const callId = danglingCallId(error);
        if (!callId || repairs >= MAX_REPAIRS) throw error;
        // A previous turn was cut off after the model called a tool: answer that call first.
        repairs += 1;
        input = [
          {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ error: 'The previous request was interrupted.' }),
          },
          ...input,
        ];
        step -= 1;
        continue;
      }
      usage = addUsage(usage, outcome.usage);
      if (outcome.functionCalls.length === 0) return { reason: endReason(outcome), usage };
      input = await executeCalls(outcome.functionCalls, request);
    }
    return { reason: 'max_steps', usage };
  } catch (error) {
    throw fromOpenAIError(error, isDeadline(request.signal));
  }
}
