import { z } from 'zod';
import { normalizeReplies } from '../protocol/replies';
import { isToolUi, TOOL_NAME, type ToolUi, toToolUiData } from '../protocol/tool-ui';
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

/**
 * A value as `JSON.parse(JSON.stringify(value))` returns it: `toJSON()` applied (a `Date` becomes
 * a string), functions, symbols and `undefined` fields gone.
 */
export type Jsonified<T> = T extends { toJSON(): infer R }
  ? Jsonified<R>
  : T extends bigint | symbol | ((...args: never[]) => unknown) | undefined
    ? never
    : T extends readonly (infer Item)[]
      ? Jsonified<Item>[]
      : T extends object
        ? { [Key in keyof T as Jsonified<T[Key]> extends never ? never : Key]: Jsonified<T[Key]> }
        : T;

export interface ToolDefinition<
  Input extends z.ZodObject,
  Output = unknown,
  Ui = unknown,
  Name extends string = string,
> {
  /** Name the model calls, 1–64 letters, digits, `_` or `-`. */
  readonly name: Name;
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
   * the options come back the same after a reload. A call that failed defines none. At most 4 of
   * up to 80 characters are shown, plain text without links; the others are dropped. The visitor
   * sends a clicked option as their own message. Only the latest answer shows options; when
   * several calls of a turn define them, the last one wins.
   */
  readonly replies?: (output: Jsonified<Output>) => readonly string[] | undefined;
  /**
   * What the visitor may see of a successful result, for a component the site registers with
   * `toolRenderers` (ADR-0017). Only this reaches the browser, never the result itself, so pick
   * the fields a visitor may see. It gets the result as the model received it, parsed back from
   * JSON, and runs again on every reload, so keep it pure: the same result, the same payload.
   * Return plain JSON of at most 8 KB and 8 levels, or `undefined` or `null` for none; a payload
   * over a limit is dropped whole. An answer shows at most 4, in call order.
   */
  readonly ui?: (output: Jsonified<Output>) => Ui | null | undefined;
}

/**
 * A tool the bot can call. `Name` and `Ui` carry the tool's name and the type its `ui` returns,
 * so a page can type its renderers with `import type` (ADR-0017).
 */
export interface Tool<Name extends string = string, Ui = unknown> {
  readonly name: Name;
  readonly description: string;
  readonly input: z.ZodObject;
  readonly execute: (input: unknown, context: ToolContext) => unknown;
  readonly timeoutMs: number;
  readonly replies?: ((output: unknown) => readonly string[] | undefined) | undefined;
  readonly ui?: ((output: unknown) => Ui | null | undefined) | undefined;
}

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
export function defineTool<
  Input extends z.ZodObject,
  Output = unknown,
  Ui = never,
  const Name extends string = string,
>(definition: ToolDefinition<Input, Output, Ui, Name>): Tool<Name, Ui> {
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
  if (definition.ui !== undefined && typeof definition.ui !== 'function') {
    problems.push('ui must be a function of the result');
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
    ...(definition.ui ? { ui: definition.ui as (output: unknown) => Ui | null | undefined } : {}),
  });
}

/** A function call as stored: arguments and output in JSON, no output if it failed or wasn't answered. */
export interface StoredToolCall {
  /** Needed for UI payloads, which the browser tells apart by call. */
  readonly callId?: string | undefined;
  readonly name: string;
  readonly arguments: string;
  readonly output: string | undefined;
}

/** The tool's output for a call, if it ran with arguments that fit its schema and succeeded. */
function successfulOutput(tool: Tool, call: StoredToolCall): unknown {
  if (call.output === undefined) return undefined;
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    // The live turn refused these arguments, so the tool never ran.
    return undefined;
  }
  return tool.input.safeParse(args).success ? JSON.parse(call.output) : undefined;
}

/**
 * The options a turn's calls define, oldest call first (ADR-0015): the last call that
 * defines any wins. The live turn and the history both pick them here, from the stored JSON, so a
 * reload shows what the turn showed. Arguments that don't fit the tool's schema mean the call
 * failed, and a tool the bot no longer has defines nothing. A `replies` function that throws
 * defines none; `onError` hears about it.
 */
export function readToolReplies(
  tools: readonly Tool[],
  calls: readonly StoredToolCall[],
  onError?: (tool: Tool, error: unknown) => void,
): readonly string[] | undefined {
  let replies: readonly string[] | undefined;
  for (const call of calls) {
    const tool = tools.find((candidate) => candidate.name === call.name);
    if (!tool?.replies) continue;
    try {
      const output = successfulOutput(tool, call);
      if (output === undefined) continue;
      const items = tool.replies(output);
      const offered = Array.isArray(items) ? normalizeReplies(items) : undefined;
      if (offered) replies = offered;
    } catch (error) {
      onError?.(tool, error);
    }
  }
  return replies;
}

/** A `ui` payload broke the limits of ADR-0017; it says so without quoting the payload. */
export class ToolUiLimitError extends Error {
  constructor() {
    super('the payload is not plain JSON of at most 8 KB and 8 levels');
    this.name = 'ToolUiLimitError';
  }
}

/**
 * The payloads a turn's calls define for the visitor, in call order (ADR-0017), as the live turn
 * and the history both send them. A call without an ID, a failed call and a tool without `ui`
 * define none. A `ui` that throws, or returns a payload over the limits, defines none either;
 * `onError` hears about it. The caller keeps at most `MAX_TOOL_UI` per answer.
 */
export function readToolUi(
  tools: readonly Tool[],
  calls: readonly StoredToolCall[],
  onError?: (tool: Tool, error: unknown) => void,
): readonly ToolUi[] {
  const payloads: ToolUi[] = [];
  for (const call of calls) {
    const tool = tools.find((candidate) => candidate.name === call.name);
    if (!tool?.ui || call.callId === undefined || call.output === undefined) continue;
    try {
      const output = successfulOutput(tool, call);
      if (output === undefined) continue;
      const value = tool.ui(output);
      if (value === undefined || value === null) continue;
      const data = toToolUiData(value);
      if (data === undefined) throw new ToolUiLimitError();
      const payload = { callId: call.callId, name: tool.name, data };
      // A call ID the protocol can't carry would be refused by every client.
      if (isToolUi(payload)) payloads.push(payload);
    } catch (error) {
      onError?.(tool, error);
    }
  }
  return payloads;
}
