import type OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { newItemId, visitorItem } from '../conversations/items';
import { conversationBusy, storeFailure } from '../conversations/owner';
import {
  type ConversationContext,
  type StoredItem,
  VersionConflictError,
} from '../conversations/port';
import { AskdareError } from '../errors';
import type { TokenUsage, TurnRequest, TurnResult } from '../gateway';
import type { MessageEndReason } from '../protocol/events';
import type { ToolUi } from '../protocol/tool-ui';
import { SUGGEST_REPLIES, suggestedReplies } from '../tools/suggest-replies';
import { addUsage, ZERO_USAGE } from '../usage';
import { fromOpenAIError } from './errors';
import { guardedInstructions } from './guardrails';
import { toResponseInput } from './items';
import { fromResponseOutput, modelFamily, replayInput } from './replay';
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

/** Function call outputs as stored items. */
function storedOutputs(items: readonly ResponseInputItem[]): StoredItem[] {
  return items.flatMap((item): StoredItem[] =>
    item.type === 'function_call_output' &&
    typeof item.output === 'string' &&
    typeof item.call_id === 'string'
      ? [{ id: newItemId(), type: 'call_output', callId: item.call_id, output: item.output }]
      : [],
  );
}

/**
 * Stores the answer to a `suggest_replies` call that came after the answer, without another model
 * call (ADR-0015). Best effort: if it fails, the next turn answers the call before it starts.
 * Provider stores only; an item store writes them with the step.
 */
async function storeOutputs(request: TurnRequest, items: ResponseInputItem[]): Promise<void> {
  try {
    await request.conversations.append(request.conversationId, storedOutputs(items), {
      signal: request.signal,
    });
  } catch (error) {
    // The answer is complete: only a visitor who left ends the turn here, not the deadline.
    if (request.signal.aborted && !isDeadline(request.signal)) throw error;
    console.error('[askdare] could not store the answer to suggest_replies; the next turn will.');
  }
}

/**
 * A conversation an item store keeps (ADR-0024, decision 3): every request replays the whole
 * history with `store: false`, so nothing of it stays at OpenAI, and the turn appends what it
 * produces in an order that never stores a call without its output.
 */
class Replay {
  readonly #request: TurnRequest;
  readonly #family: string;
  readonly #history: ResponseInputItem[];
  #version: number;

  private constructor(request: TurnRequest, history: ResponseInputItem[], version: number) {
    this.#request = request;
    this.#family = modelFamily(request.bot.model);
    this.#history = history;
    this.#version = version;
  }

  /**
   * Appends the visitor's message before the first model call, at the version the context was
   * read at: of two turns started on the same version, exactly one gets this far.
   */
  static async start(
    request: TurnRequest,
    context: Extract<ConversationContext, { kind: 'items' }>,
  ): Promise<Replay> {
    const replay = new Replay(request, [], context.version);
    const visitor = visitorItem(request);
    await replay.#append([visitor]);
    replay.#history.push(...replayInput([...context.items, visitor], replay.#family));
    return replay;
  }

  /** The input of the next model call: the whole conversation so far. */
  get input(): ResponseInputItem[] {
    return [...this.#history];
  }

  /**
   * Stores one step: its output items together with the outputs of its calls, in one append, so
   * a crash loses at most the step in flight. Resolves to a lookup of each output item's stored ID.
   */
  async record(
    outcome: StepOutcome,
    outputs: readonly ResponseInputItem[],
    citations: CitationRegistry,
  ): Promise<(providerId: string) => string | undefined> {
    const ids = new Map<string, string>();
    const items: StoredItem[] = [];
    let lastMessage: string | undefined;
    for (const output of outcome.output) {
      const item = fromResponseOutput(output, this.#family, citations.sources);
      if (!item) continue;
      items.push(item);
      if (item.type === 'message') lastMessage = item.id;
      if ('id' in output && typeof output.id === 'string') ids.set(output.id, item.id);
    }
    items.push(...storedOutputs(outputs));
    await this.#append(items);
    this.#history.push(...replayInput(items, this.#family));
    // A server whose streamed IDs differ from its final ones: the answer is the last message.
    return (providerId) => ids.get(providerId) ?? lastMessage;
  }

  async #append(items: readonly StoredItem[]): Promise<void> {
    try {
      this.#version = await this.#request.conversations.append(
        this.#request.conversationId,
        items,
        { expect: this.#version, signal: this.#request.signal },
      );
    } catch (error) {
      // Another turn wrote first: this one stores nothing more (ADR-0024, decision 3).
      if (error instanceof VersionConflictError) throw conversationBusy(error);
      const { conversations, conversationId, signal } = this.#request;
      throw await storeFailure(conversations, conversationId, error, signal);
    }
  }
}

async function runStep(
  client: OpenAI,
  request: TurnRequest,
  context: ConversationContext,
  input: ResponseInputItem[],
  citations: CitationRegistry,
  choice: ReturnType<typeof toolChoice>,
): Promise<StepOutcome> {
  const { bot } = request;
  const tools = responseTools(bot);
  const stream = await client.responses.create(
    {
      model: bot.model,
      instructions: guardedInstructions(bot, bot.instructions(request.context)),
      input,
      ...(context.kind === 'provider'
        ? {
            conversation: context.ref,
            // store:false would silently drop the turn from the conversation (spike S1, E10).
            store: true,
            // Deprecated in favour of server-side compaction (`context_management`), which spikes
            // S5 and S5b kept out for now: below ~100k tokens it never shrinks the input
            // (ADR-0003). Kept while OpenAI announces no shutdown date: without it a long
            // conversation fails with 400 instead of dropping its oldest items. If it ever fails,
            // `fromOpenAIError` maps the overflow to `error.conversationTooLong`.
            truncation: 'auto' as const,
          }
        : {
            // Replayed from an item store: nothing of the conversation stays at OpenAI, and the
            // whole history goes in, which `limits.maxTurns` bounds (ADR-0024, decision 3).
            // Encrypted reasoning comes back by default (reasoning guide, "Preserve reasoning
            // without stored responses").
            store: false,
          }),
      stream: true,
      max_output_tokens: bot.limits.maxOutputTokens,
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
 * Runs one chat turn against the Responses API: the model may call the bot's tools for up to
 * `maxSteps - 1` rounds, and the last step must answer in text. Inside an OpenAI conversation by
 * default; with an item store, statelessly from the stored items. All request parameters are
 * server-controlled.
 */
export async function runTurn(client: OpenAI, request: TurnRequest): Promise<TurnResult> {
  const { bot } = request;
  const citations = new CitationRegistry();
  let usage: TokenUsage = ZERO_USAGE;
  let repairs = 0;
  // Options the bot's tools defined in this turn; a later call's replace an earlier one's.
  let toolReplies: readonly string[] | undefined;
  // Options the model suggested in this turn; it may do so once (ADR-0015).
  let replies: readonly string[] | undefined;
  // The server keeps at most four per answer (server/stream-turn.ts).
  const onUi = (ui: ToolUi): void =>
    request.emit({ type: 'tool.ui', messageId: request.messageId, ...ui });
  // Model calls the budget holds. A step may call tools only when the call after it is held too.
  let covered = 1;
  const covers = async (call: number): Promise<boolean> => {
    if (covered >= call) return true;
    if (request.reserveCall && !(await request.reserveCall())) return false;
    covered = call;
    return true;
  };
  try {
    const context = await request.conversations
      .context(request.conversationId, { signal: request.signal })
      .catch(async (error: unknown) => {
        throw await storeFailure(
          request.conversations,
          request.conversationId,
          error,
          request.signal,
        );
      });
    if (context.kind === 'provider' && context.provider !== 'openai') {
      // Another provider's conversation can't continue in an OpenAI response.
      throw new AskdareError('bot_unavailable', {
        cause: `The conversation store keeps its conversations at "${context.provider}", which the OpenAI gateway can't continue.`,
      });
    }
    const replay = context.kind === 'items' ? await Replay.start(request, context) : undefined;
    // With a provider store, each request sends only what is new since the last one.
    let input: ResponseInputItem[] = replay
      ? replay.input
      : [toResponseInput(visitorItem(request)) as ResponseInputItem];
    for (let step = 1; step <= bot.limits.maxSteps; step += 1) {
      // The model suggests once, and not after a tool defined options, which win anyway.
      const suggest = replies === undefined && toolReplies === undefined;
      const last =
        step === bot.limits.maxSteps || (callsFunctions(bot, suggest) && !(await covers(step + 1)));
      let outcome: StepOutcome;
      try {
        outcome = await runStep(
          client,
          request,
          context,
          input,
          citations,
          toolChoice(bot, last, suggest),
        );
      } catch (error) {
        // An item store never holds a call without its output, so only OpenAI's can dangle.
        const callId = replay ? undefined : danglingCallId(error);
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
      // Options after the answer end the turn: their call is answered without the model. Models
      // mark text written before any call as commentary, options included, so text followed only
      // by options is the answer; taking another step made the model write it a second time.
      // A call before any text takes one more step.
      const answerItemId =
        outcome.answerItemId ??
        (calls.length === 0 && answered.length > 0 ? outcome.textItemId : undefined);
      if (calls.length === 0 && (answered.length === 0 || answerItemId)) {
        // The last step's items go in with the answers to its `suggest_replies` calls.
        const storedId = replay ? await replay.record(outcome, answered, citations) : undefined;
        if (!replay && answered.length > 0) await storeOutputs(request, answered);
        // Visitors rate the answer by its stored ID in an item store (ADR-0024).
        const rated = answerItemId && storedId ? storedId(answerItemId) : answerItemId;
        const offered = toolReplies ?? replies;
        return {
          reason: endReason(outcome),
          usage,
          ...(rated ? { answerItemId: rated } : {}),
          // A tool's own options win over the model's suggestion (ADR-0015).
          ...(offered ? { replies: offered } : {}),
        };
      }
      const outputs = [
        ...answered,
        ...(calls.length > 0
          ? await executeCalls(calls, request, {
              onReplies: (items) => {
                toolReplies = items;
              },
              onUi,
            })
          : []),
      ];
      if (replay) {
        // The step's calls are stored only with their outputs, after every call has one.
        await replay.record(outcome, outputs, citations);
        input = replay.input;
      } else {
        input = outputs;
      }
    }
    return { reason: 'max_steps', usage };
  } catch (error) {
    throw fromOpenAIError(error, isDeadline(request.signal));
  }
}
