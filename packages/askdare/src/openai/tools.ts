import { zodResponsesFunction } from 'openai/helpers/zod';
import type {
  ResponseInputItem,
  Tool as ResponseTool,
  ToolChoiceAllowed,
  ToolChoiceOptions,
} from 'openai/resources/responses/responses';
import { z } from 'zod';
import type { Bot } from '../bot/define-bot';
import type { ToolCallRecord, TurnRequest } from '../gateway';
import { type Tool, toolReplies } from '../tools/define-tool';
import type { FunctionCall } from './stream-mapper';

/** Larger tool results are replaced by an error so one call can't flood the context. */
const MAX_OUTPUT_CHARS = 16_000;

const definitions = new WeakMap<Bot, ResponseTool[]>();

/** The bot's tools as the Responses API expects them, converted once per bot. */
export function responseTools(bot: Bot): ResponseTool[] {
  let tools = definitions.get(bot);
  if (!tools) {
    tools = bot.tools.map((tool): ResponseTool => {
      const converted = zodResponsesFunction({
        name: tool.name,
        description: tool.description,
        parameters: tool.input,
      });
      return {
        type: 'function',
        name: converted.name,
        description: converted.description ?? null,
        parameters: converted.parameters,
        strict: true,
      };
    });
    if (bot.knowledge) {
      tools.push({
        type: 'file_search',
        vector_store_ids: [bot.knowledge.vectorStoreId],
        max_num_results: bot.knowledge.maxResults,
      });
    }
    definitions.set(bot, tools);
  }
  return tools;
}

/**
 * On the last step a function call could no longer be answered, so only hosted tools stay
 * available. Restricting through `allowed_tools` keeps the tool list, and the prompt cache, intact.
 */
export function toolChoice(bot: Bot, lastStep: boolean): ToolChoiceOptions | ToolChoiceAllowed {
  if (!lastStep || bot.tools.length === 0) return 'auto';
  return bot.knowledge
    ? { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'file_search' }] }
    : 'none';
}

class ToolTimeoutError extends Error {}

async function withTimeout<T>(
  run: (signal: AbortSignal) => T,
  timeoutMs: number,
  parent: AbortSignal,
): Promise<Awaited<T>> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(parent.reason);
  parent.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new ToolTimeoutError());
      reject(new ToolTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(run(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onAbort);
  }
}

type CallOutcome = ToolCallRecord['outcome'];

/**
 * How the outputs `invoke` and `executeCalls` write for failed calls begin. History skips them,
 * since a failed call defines no reply options.
 */
const FAILURES = [
  'Unknown tool "',
  'Arguments were not valid JSON.',
  'Invalid arguments: ',
  'The tool timed out.',
  'The tool failed.',
  'The tool returned too much data.',
] as const;

/** Whether a stored output is one askdare wrote for a failed call rather than the tool's result. */
export function isFailedOutput(output: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return true;
  }
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 1) return false;
  const { error } = value as { error?: unknown };
  return typeof error === 'string' && FAILURES.some((start) => error.startsWith(start));
}

async function invoke(
  tool: Tool | undefined,
  call: FunctionCall,
  request: TurnRequest,
): Promise<{ readonly output: unknown; readonly outcome: CallOutcome }> {
  if (!tool) return { output: { error: `Unknown tool "${call.name}".` }, outcome: 'error' };
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return { output: { error: 'Arguments were not valid JSON.' }, outcome: 'error' };
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    return {
      output: { error: `Invalid arguments: ${z.prettifyError(parsed.error)}` },
      outcome: 'error',
    };
  }
  try {
    const output = await withTimeout(
      (signal) =>
        tool.execute(parsed.data, {
          botId: request.bot.id,
          visitorId: request.visitorId,
          locale: request.context.locale,
          identity: request.context.identity,
          signal,
        }),
      tool.timeoutMs,
      request.signal,
    );
    return { output: output ?? null, outcome: 'ok' };
  } catch (error) {
    if (error instanceof ToolTimeoutError) {
      return { output: { error: 'The tool timed out.' }, outcome: 'timeout' };
    }
    if (request.signal.aborted) throw request.signal.reason;
    // The developer needs the details; the model and the visitor only learn that it failed.
    console.error(`[askdare] tool "${tool.name}" failed:`, error);
    return { output: { error: 'The tool failed.' }, outcome: 'error' };
  }
}

/**
 * Runs every function call of a step in parallel and returns the outputs to send back. Every call
 * gets an output, even on failure: a call left without one breaks the conversation (spike S1, E5).
 * When a successful call's tool defines reply options, the last such call's go to `onReplies`.
 */
export async function executeCalls(
  calls: readonly FunctionCall[],
  request: TurnRequest,
  onReplies?: (replies: readonly string[]) => void,
): Promise<ResponseInputItem[]> {
  const tools = new Map(request.bot.tools.map((tool) => [tool.name, tool]));
  for (const call of calls) {
    request.emit({
      type: 'tool.status',
      messageId: request.messageId,
      callId: call.callId,
      name: call.name.slice(0, 64),
      state: 'running',
    });
  }
  const offered: (readonly string[] | undefined)[] = [];
  const outputs = await Promise.all(
    calls.map(async (call, index) => {
      const startedAt = Date.now();
      const tool = tools.get(call.name);
      const result = await invoke(tool, call, request);
      let output = JSON.stringify(result.output);
      let outcome = result.outcome;
      if (output.length > MAX_OUTPUT_CHARS) {
        output = JSON.stringify({ error: 'The tool returned too much data.' });
        outcome = 'error';
      }
      request.onToolCall?.({
        name: call.name.slice(0, 64),
        startedAt,
        durationMs: Date.now() - startedAt,
        outcome,
      });
      request.emit({
        type: 'tool.status',
        messageId: request.messageId,
        callId: call.callId,
        name: call.name.slice(0, 64),
        state: outcome === 'ok' ? 'done' : 'error',
      });
      // From the output as stored, so a reload rebuilds the same options (openai/history.ts).
      if (tool && outcome === 'ok') offered[index] = toolReplies(tool, output);
      return { type: 'function_call_output', call_id: call.callId, output } as const;
    }),
  );
  const replies = offered.findLast((items) => items !== undefined);
  if (replies) onReplies?.(replies);
  return outputs;
}

const DANGLING_CALL = /No tool output found for function call ([A-Za-z0-9_-]+)/;

/** The call ID from a 400 caused by a call left without output in an earlier, aborted turn. */
export function danglingCallId(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return DANGLING_CALL.exec(error.message)?.[1];
}
