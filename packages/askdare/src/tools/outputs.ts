import type { Bot } from '../bot/define-bot';

/** What the model gets when a call fails after its arguments were valid. */
export const FAILURES = {
  timeout: { error: 'The tool timed out.' },
  failed: { error: 'The tool failed.' },
  tooLarge: { error: 'The tool returned too much data.' },
} as const;

const FAILED_OUTPUTS: ReadonlySet<string> = new Set(
  Object.values(FAILURES).map((failure) => JSON.stringify(failure)),
);

/**
 * Whether a stored output is one askdare wrote for a call that failed while running. Calls with
 * invalid arguments are recognized by their arguments instead (`readToolReplies`).
 */
export function isFailedOutput(output: string): boolean {
  return FAILED_OUTPUTS.has(output);
}

/** The key that wraps a tool's result as untrusted data (`toolResults: 'untrusted'`). */
export const UNTRUSTED = 'untrusted_tool_result';

/**
 * A successful tool result as the model gets it. JSON-encoded inside the wrapper, so nothing in it
 * can close the wrapper early.
 */
export function wrapToolOutput(bot: Bot, output: string): string {
  return bot.guardrails.toolResults === 'untrusted' ? `{"${UNTRUSTED}":${output}}` : output;
}

/** A stored result without its wrapper, as the tool returned it, for reading options and cards. */
export function unwrapToolOutput(output: string): string {
  if (!output.startsWith(`{"${UNTRUSTED}":`)) return output;
  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 1) {
      return JSON.stringify((parsed as Record<string, unknown>)[UNTRUSTED]);
    }
  } catch {
    // Not one of ours.
  }
  return output;
}
