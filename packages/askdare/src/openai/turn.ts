import type OpenAI from 'openai';
import type { ResponseInputContent, ResponseInputItem } from 'openai/resources/responses/responses';
import type { TokenUsage, TurnRequest, TurnResult } from '../gateway';
import type { MessageEndReason } from '../protocol/events';
import { SUGGEST_REPLIES, suggestedReplies } from '../tools/suggest-replies';
import { addUsage, ZERO_USAGE } from '../usage';
import { fromOpenAIError } from './errors';
import { pageContextPart } from './page-context';
import {
  CitationRegistry,
  type FunctionCall,
  ResponseStreamMapper,
  type StepOutcome,
} from './stream-mapper';
import {
  answerSuggestions,
  callsFunctions,
  danglingCallId,
  executeCalls,
  responseTools,
  toolChoice,
} from './tools';

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

/** The visitor's turn: their text, the page's description if any, and attached files. */
function userInput(request: TurnRequest): ResponseInputItem {
  const attachments = request.attachments ?? [];
  if (attachments.length === 0 && !request.pageContext) {
    return { role: 'user', content: request.text };
  }
  const content: ResponseInputContent[] = [
    ...(request.pageContext ? [pageContextPart(request.pageContext)] : []),
    ...(request.text ? [{ type: 'input_text' as const, text: request.text }] : []),
  ];
  for (const attachment of attachments) {
    content.push(
      attachment.kind === 'image'
        ? { type: 'input_image', file_id: attachment.fileId, detail: 'auto' }
        : { type: 'input_file', file_id: attachment.fileId },
    );
  }
  return { role: 'user', content };
}

/**
 * Stores the answer to a `suggest_replies` call that came after the answer, without another model
 * call (ADR-0015). Best effort: if it fails, the next turn answers the call before it starts.
 */
async function storeOutputs(
  client: OpenAI,
  request: TurnRequest,
  items: ResponseInputItem[],
): Promise<void> {
  try {
    await client.conversations.items.create(
      request.conversationId,
      { items },
      { signal: request.signal },
    );
  } catch (error) {
    // The answer is complete: only a visitor who left ends the turn here, not the deadline.
    if (request.signal.aborted && !isDeadline(request.signal)) throw error;
    console.error('[askdare] could not store the answer to suggest_replies; the next turn will.');
  }
}

async function runStep(
  client: OpenAI,
  request: TurnRequest,
  input: ResponseInputItem[],
  citations: CitationRegistry,
  choice: ReturnType<typeof toolChoice>,
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
      // Deprecated in favour of server-side compaction (`context_management`), which spikes S5
      // and S5b kept out for now: below ~100k tokens it never shrinks the input (ADR-0003).
      // Still accepted.
      truncation: 'auto',
      safety_identifier: request.safetyIdentifier,
      prompt_cache_key: `askdare:${bot.id}`,
      ...(tools.length > 0 ? { tools, tool_choice: choice, parallel_tool_calls: true } : {}),
      // Search results carry the titles and URLs that file citations link to.
      ...(bot.knowledge ? { include: ['file_search_call.results' as const] } : {}),
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
  let usage: TokenUsage = ZERO_USAGE;
  let input: ResponseInputItem[] = [userInput(request)];
  let repairs = 0;
  // Options the bot's tools defined in this turn; a later call's replace an earlier one's.
  let toolReplies: readonly string[] | undefined;
  // Options the model suggested in this turn; it may do so once (ADR-0015).
  let replies: readonly string[] | undefined;
  // Model calls the budget holds. A step may call tools only when the call after it is held too.
  let covered = 1;
  const covers = async (call: number): Promise<boolean> => {
    if (covered >= call) return true;
    if (request.reserveCall && !(await request.reserveCall())) return false;
    covered = call;
    return true;
  };
  try {
    for (let step = 1; step <= bot.limits.maxSteps; step += 1) {
      // The model suggests once, and not after a tool defined options, which win anyway.
      const suggest = replies === undefined && toolReplies === undefined;
      const last =
        step === bot.limits.maxSteps || (callsFunctions(bot, suggest) && !(await covers(step + 1)));
      let outcome: StepOutcome;
      try {
        outcome = await runStep(client, request, input, citations, toolChoice(bot, last, suggest));
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
      request.onStep?.({ model: outcome.model, usage: outcome.usage });
      const suggestions: FunctionCall[] = [];
      const calls: FunctionCall[] = [];
      for (const call of outcome.functionCalls) {
        (call.name === SUGGEST_REPLIES ? suggestions : calls).push(call);
      }
      const latest = suggestions.at(-1);
      if (latest) replies = suggestedReplies(latest.arguments) ?? [];
      const answered = answerSuggestions(suggestions);
      // Options after a visible answer end the turn: their call is answered without the model.
      // A call before the answer, or text the model marked as commentary, takes one more step.
      if (calls.length === 0 && (answered.length === 0 || outcome.answerItemId)) {
        if (answered.length > 0) await storeOutputs(client, request, answered);
        const offered = toolReplies ?? replies;
        return {
          reason: endReason(outcome),
          usage,
          ...(outcome.answerItemId ? { answerItemId: outcome.answerItemId } : {}),
          // A tool's own options win over the model's suggestion (ADR-0015).
          ...(offered ? { replies: offered } : {}),
        };
      }
      input = [
        ...answered,
        ...(calls.length > 0
          ? await executeCalls(calls, request, (items) => {
              toolReplies = items;
            })
          : []),
      ];
    }
    return { reason: 'max_steps', usage };
  } catch (error) {
    throw fromOpenAIError(error, isDeadline(request.signal));
  }
}
