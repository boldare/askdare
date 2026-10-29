import { z } from 'zod';

/** What a tool may know about the request. Identity here is verified, never chosen by the model. */
export interface ToolContext {
  readonly botId: string;
  /** Server-generated, pseudonymous visitor ID. */
  readonly visitorId: string;
  readonly locale: string;
  /** Aborted when the visitor leaves, the turn deadline passes or the tool times out. */
  readonly signal: AbortSignal;
}

export interface ToolDefinition<Input extends z.ZodObject> {
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
  readonly execute: (input: z.infer<Input>, context: ToolContext) => unknown;
  /** Default 10 s. */
  readonly timeoutMs?: number;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodObject;
  readonly execute: (input: unknown, context: ToolContext) => unknown;
  readonly timeoutMs: number;
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
export function defineTool<Input extends z.ZodObject>(definition: ToolDefinition<Input>): Tool {
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
  if (problems.length > 0) {
    throw new TypeError(`[chatdock] Invalid tool "${definition.name}": ${problems.join('; ')}`);
  }
  return Object.freeze({
    name: definition.name,
    description: definition.description.trim(),
    input: definition.input,
    execute: definition.execute as (input: unknown, context: ToolContext) => unknown,
    timeoutMs,
  });
}
