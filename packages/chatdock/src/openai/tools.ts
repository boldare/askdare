import { zodResponsesFunction } from 'openai/helpers/zod';
import type { FunctionTool, ResponseInputItem } from 'openai/resources/responses/responses';
import { z } from 'zod';
import type { Bot } from '../bot/define-bot';
import type { TurnRequest } from '../gateway';
import type { Tool } from '../tools/define-tool';
import type { FunctionCall } from './stream-mapper';

/** Larger tool results are replaced by an error so one call can't flood the context. */
const MAX_OUTPUT_CHARS = 16_000;

const definitions = new WeakMap<Bot, FunctionTool[]>();

/** OpenAI strict function tools for a bot, converted once per bot. */
export function responseTools(bot: Bot): FunctionTool[] {
  let tools = definitions.get(bot);
  if (!tools) {
    tools = bot.tools.map((tool) => {
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
    definitions.set(bot, tools);
  }
  return tools;
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

async function invoke(
  tool: Tool | undefined,
  call: FunctionCall,
  request: TurnRequest,
): Promise<{ readonly output: unknown; readonly ok: boolean }> {
  if (!tool) return { output: { error: `Unknown tool "${call.name}".` }, ok: false };
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return { output: { error: 'Arguments were not valid JSON.' }, ok: false };
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    return { output: { error: `Invalid arguments: ${z.prettifyError(parsed.error)}` }, ok: false };
  }
  try {
    const output = await withTimeout(
      (signal) =>
        tool.execute(parsed.data, {
          botId: request.bot.id,
          visitorId: request.visitorId,
          locale: request.context.locale,
          signal,
        }),
      tool.timeoutMs,
      request.signal,
    );
    return { output: output ?? null, ok: true };
  } catch (error) {
    if (error instanceof ToolTimeoutError) {
      return { output: { error: 'The tool timed out.' }, ok: false };
    }
    if (request.signal.aborted) throw request.signal.reason;
    // The developer needs the details; the model and the visitor only learn that it failed.
    console.error(`[chatdock] tool "${tool.name}" failed:`, error);
    return { output: { error: 'The tool failed.' }, ok: false };
  }
}

/**
 * Runs every function call of a step in parallel and returns the outputs to send back. Every call
 * gets an output, even on failure: a call left without one breaks the conversation (spike S1, E5).
 */
export async function executeCalls(
  calls: readonly FunctionCall[],
  request: TurnRequest,
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
  return Promise.all(
    calls.map(async (call) => {
      const result = await invoke(tools.get(call.name), call, request);
      let output = JSON.stringify(result.output);
      let ok = result.ok;
      if (output.length > MAX_OUTPUT_CHARS) {
        output = JSON.stringify({ error: 'The tool returned too much data.' });
        ok = false;
      }
      request.emit({
        type: 'tool.status',
        messageId: request.messageId,
        callId: call.callId,
        name: call.name.slice(0, 64),
        state: ok ? 'done' : 'error',
      });
      return { type: 'function_call_output', call_id: call.callId, output } as const;
    }),
  );
}

const DANGLING_CALL = /No tool output found for function call ([A-Za-z0-9_-]+)/;

/** The call ID from a 400 caused by a call left without output in an earlier, aborted turn. */
export function danglingCallId(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return DANGLING_CALL.exec(error.message)?.[1];
}
