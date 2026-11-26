// Frozen copy of protocol/tool-ui.ts as released in @boldare/askdare 0.6.0, for protocol-0.6.test.ts. Never edit.
/*
 * Tool UI payloads (ADR-0017): what a tool's `ui` function picks from its result for the visitor
 * to see as a card. The server turns a payload into plain JSON with `toToolUiData`; both sides
 * check what goes over the wire with `isToolUi`.
 */

/** Payloads one answer carries, in call order; later ones are dropped. */
export const MAX_TOOL_UI = 4;
/** Bytes of a payload's JSON, UTF-8. */
export const MAX_TOOL_UI_BYTES = 8192;
/** Nested arrays and objects in a payload; the outermost one counts as the first. */
export const MAX_TOOL_UI_DEPTH = 8;

/** One tool call's payload, as the `tool.ui` event and the history carry it. */
export interface ToolUi {
  /** The call, as in `tool.status`. Opaque. */
  readonly callId: string;
  /** The tool's name, which picks the renderer. */
  readonly name: string;
  /** Whatever the tool's `ui` returned: plain JSON, never `null`. */
  readonly data: unknown;
}

/** A tool's name: what `defineTool` accepts and what the protocol carries. */
export const TOOL_NAME: RegExp = /^[a-zA-Z0-9_-]{1,64}$/;

/** Whether a value is plain JSON: no `undefined`, functions, class instances or `NaN`. */
function isPlainJson(value: unknown, depth: number): boolean {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (value === null) return true;
      if (depth >= MAX_TOOL_UI_DEPTH) return false;
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          // A hole would come out as null, so the visitor would get something `ui` didn't return.
          if (!(index in value) || !isPlainJson(value[index], depth + 1)) return false;
        }
        return true;
      }
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      return Object.values(value).every((item) => isPlainJson(item, depth + 1));
    }
    default:
      return false;
  }
}

/** The payload's JSON, or undefined when it isn't plain JSON within the size and depth limits. */
function wireJson(value: unknown): string | undefined {
  if (value === null || value === undefined || !isPlainJson(value, 0)) return undefined;
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).length <= MAX_TOOL_UI_BYTES ? json : undefined;
}

/**
 * The payload as it goes over the wire: a fresh copy of plain JSON within the limits, or
 * undefined when it breaks one. A payload is sent whole or not at all, never cut.
 */
export function toToolUiData(value: unknown): unknown {
  const json = wireJson(value);
  return json === undefined ? undefined : JSON.parse(json);
}

/** One payload as it goes over the wire: a call ID, a tool name and data within the limits. */
export function isToolUi(value: unknown): value is ToolUi {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { callId, name, data } = value as Record<string, unknown>;
  return (
    typeof callId === 'string' &&
    callId.length > 0 &&
    callId.length <= 128 &&
    typeof name === 'string' &&
    TOOL_NAME.test(name) &&
    wireJson(data) !== undefined
  );
}

/** A list of payloads as it goes over the wire: 1 to 4, each valid, no call twice. */
export function isToolUiList(value: unknown): value is readonly ToolUi[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_TOOL_UI &&
    value.every(isToolUi) &&
    new Set(value.map((item: ToolUi) => item.callId)).size === value.length
  );
}
