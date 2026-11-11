import { z } from 'zod';
import { normalizeReplies } from '../protocol/replies';
import type { VisitorIdentity } from '../security/identity';

/** What a tool may know about the request. Identity here is verified, never chosen by the model. */
export interface ToolContext {
  readonly botId: string;
  /** Server-generated, pseudonymous visitor ID. */
  readonly visitorId: string;
  readonly locale: string;
  /**
   * The signed-in user, verified with IDENTITY_SECRET (ADR-0009); undefined for anonymous
   * visitors. Trust only this for who the visitor is, never the model's arguments.
   */
  readonly identity?: VisitorIdentity | undefined;
  /** Aborted when the visitor leaves, the turn deadline passes or the tool times out. */
  readonly signal: AbortSignal;
}

export interface ToolDefinition<Input extends z.ZodObject, Output = unknown> {
  /** Name the model calls, 1–64 letters, digits, `_` or `-`. */
  readonly name: string;
  /** Tells the model when and how to use the tool. */
  readonly description: string;
  /**
   * Arguments schema. OpenAI strict mode requires every field: use `.nullable()` instead of
   * `.optional()`.
   */
  readonly input: Input;
  /** Runs on the server with validated arguments. The result is sent back to the model as JSON. */
  readonly execute: (input: z.infer<Input>, context: ToolContext) => Output | PromiseLike<Output>;
  /** Default 10 s. */
  readonly timeoutMs?: number;
  /**
   * Options the visitor can click under the answer, derived from a successful result (ADR-0015).
   * It gets the result as the model received it, parsed back from JSON (a `Date` is a string), so
   * the options come back the same after a reload. At most 4 of up to 80 characters are shown,
   * plain text without links; the others are dropped. The visitor sends a clicked option as their
   * own message. Only the latest answer shows options; when several calls of a turn define them,
   * the last one wins.
   */
  readonly replies?: (output: Output) => readonly string[] | undefined;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodObject;
  readonly execute: (input: unknown, context: ToolContext) => unknown;
  readonly timeoutMs: number;
  readonly replies?: ((output: unknown) => readonly string[] | undefined) | undefined;
}

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Finds fields OpenAI strict mode would reject, so they fail at startup instead of mid-chat. */
function strictModeProblems(schema: z.ZodType, path: string): string[] {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return [`${path || '(root)'} is optional; use .nullable() so the field is always present`];
  }
  if (schema instanceof z.ZodNullable)
    return strictModeProblems(schema.unwrap() as z.ZodType, path);
  if (schema instanceof z.ZodArray)
    return strictModeProblems(schema.element as z.ZodType, `${path}[]`);
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, value]) =>
      strictModeProblems(value as z.ZodType, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/**
 * Declares a server-side function the model may call. Arguments are validated with the schema
 * before `execute` runs; failures are reported to the model, never to the visitor.
 */
export function defineTool<Input extends z.ZodObject, Output = unknown>(
  definition: ToolDefinition<Input, Output>,
): Tool {
  const problems: string[] = [];
  if (!TOOL_NAME.test(definition.name)) {
    problems.push('name must be 1-64 letters, digits, "_" or "-"');
  }
  if (definition.description.trim() === '') problems.push('description must not be empty');
  if (!(definition.input instanceof z.ZodObject)) problems.push('input must be a z.object schema');
  else problems.push(...strictModeProblems(definition.input, ''));
  const timeoutMs = definition.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    problems.push('timeoutMs must be an integer between 100 and 120000');
  }
  if (definition.replies !== undefined && typeof definition.replies !== 'function') {
    problems.push('replies must be a function of the result');
  }
  if (problems.length > 0) {
    throw new TypeError(`[askdare] Invalid tool "${definition.name}": ${problems.join('; ')}`);
  }
  return Object.freeze({
    name: definition.name,
    description: definition.description.trim(),
    input: definition.input,
    execute: definition.execute as (input: unknown, context: ToolContext) => unknown,
    timeoutMs,
    ...(definition.replies
      ? { replies: definition.replies as (output: unknown) => readonly string[] | undefined }
      : {}),
  });
}

/**
 * The options one successful call defines, from its output as stored (JSON), cleaned up as for
 * any source. A `replies` function that throws or returns something else defines none.
 */
export function toolReplies(tool: Tool, output: string): readonly string[] | undefined {
  if (!tool.replies) return undefined;
  try {
    const items = tool.replies(JSON.parse(output));
    return Array.isArray(items) ? normalizeReplies(items) : undefined;
  } catch (error) {
    console.error(`[askdare] replies of tool "${tool.name}" failed:`, error);
    return undefined;
  }
}

/**
 * Rebuilds the options a turn's tools defined from its stored calls, oldest first (ADR-0015):
 * the last call that defined any wins, as in the live turn. A call without an output, or whose
 * output was a failure, defines none.
 */
export function readToolReplies(
  tools: readonly Tool[],
  calls: readonly { readonly name: string; readonly output: string | undefined }[],
): readonly string[] | undefined {
  let replies: readonly string[] | undefined;
  for (const call of calls) {
    const tool = tools.find((candidate) => candidate.name === call.name);
    const items = tool && call.output !== undefined ? toolReplies(tool, call.output) : undefined;
    if (items) replies = items;
  }
  return replies;
}
