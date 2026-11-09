import type { ChatUsageReport } from '@boldare/askdare/next';
import {
  type Attributes,
  context,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';

export interface OtelUsageOptions {
  /** The tracer to record with. Default: this package's tracer from the global provider. */
  readonly tracer?: Tracer;
}

const TRACER_NAME = '@boldare/askdare-otel';

/** Our finish reasons in the conventions' usual words, where there is one. */
const FINISH_REASONS: Readonly<Record<string, string>> = {
  completed: 'stop',
  max_output_tokens: 'length',
};

/** Sets counters the conventions record only "when available and non-zero". */
function nonZero(attributes: Attributes, name: string, value: number): void {
  if (value > 0) attributes[name] = value;
}

function turnAttributes(report: ChatUsageReport): Attributes {
  const attributes: Attributes = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': 'openai',
    'gen_ai.request.model': report.model,
    'gen_ai.response.model': report.model,
    'gen_ai.request.stream': true,
    'gen_ai.usage.input_tokens': report.usage.inputTokens,
    'gen_ai.usage.output_tokens': report.usage.outputTokens,
    'askdare.bot': report.bot,
    'askdare.visitor': report.visitor,
    'askdare.outcome': report.outcome,
    'askdare.steps': report.steps,
  };
  nonZero(attributes, 'gen_ai.usage.cache_read.input_tokens', report.usage.cachedInputTokens);
  nonZero(attributes, 'gen_ai.usage.cache_write.input_tokens', report.usage.cacheWriteTokens);
  nonZero(attributes, 'gen_ai.usage.reasoning.output_tokens', report.usage.reasoningTokens);
  if (report.conversation) attributes['gen_ai.conversation.id'] = report.conversation;
  if (report.finishReason) {
    attributes['gen_ai.response.finish_reasons'] = [
      FINISH_REASONS[report.finishReason] ?? report.finishReason,
    ];
  }
  if (report.errorCode) attributes['error.type'] = report.errorCode;
  return attributes;
}

/**
 * Records each askdare chat turn as OpenTelemetry spans, for `createChatHandler({ onUsage })`:
 * a `chat <model>` span for the turn and an `execute_tool <name>` span inside it for each tool
 * call, with the attributes of the OpenTelemetry GenAI semantic conventions. A turn with several
 * model calls (tool rounds) is one `chat` span with their usage summed.
 *
 * The spans are recorded after the turn, with its real start and end times, in whatever trace
 * context is active then. They carry counters and pseudonyms only, never message text.
 *
 * ```ts
 * import { otelUsage } from '@boldare/askdare-otel';
 *
 * export const { GET, POST, DELETE } = createChatHandler({ bots, onUsage: otelUsage() });
 * ```
 */
export function otelUsage(options: OtelUsageOptions = {}): (report: ChatUsageReport) => void {
  return (report) => {
    const tracer = options.tracer ?? trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(`chat ${report.model}`, {
      kind: SpanKind.CLIENT,
      startTime: report.startedAt,
      attributes: turnAttributes(report),
    });
    const parent = trace.setSpan(context.active(), span);
    for (const tool of report.tools) {
      const child = tracer.startSpan(
        `execute_tool ${tool.name}`,
        {
          kind: SpanKind.INTERNAL,
          startTime: tool.startedAt,
          attributes: {
            'gen_ai.operation.name': 'execute_tool',
            'gen_ai.tool.name': tool.name,
            'gen_ai.tool.type': 'function',
            ...(report.conversation ? { 'gen_ai.conversation.id': report.conversation } : {}),
            ...(tool.outcome === 'ok' ? {} : { 'error.type': tool.outcome }),
          },
        },
        parent,
      );
      if (tool.outcome !== 'ok') child.setStatus({ code: SpanStatusCode.ERROR });
      child.end(tool.startedAt + tool.durationMs);
    }
    if (report.outcome === 'failed') {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        ...(report.errorCode ? { message: report.errorCode } : {}),
      });
    }
    span.end(report.startedAt + report.durationMs);
  };
}
