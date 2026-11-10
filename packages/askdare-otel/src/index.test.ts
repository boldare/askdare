import type { ChatUsageReport } from '@boldare/askdare/next';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { otelUsage } from './index';

function setup() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { exporter, onUsage: otelUsage({ tracer: provider.getTracer('test') }) };
}

const REPORT: ChatUsageReport = {
  bot: 'support',
  model: 'test-model-2026',
  conversation: 'c0nv',
  visitor: 'v1s1t0r',
  startedAt: 1_800_000_000_000,
  durationMs: 2_500,
  outcome: 'completed',
  finishReason: 'completed',
  usage: {
    inputTokens: 1_200,
    cachedInputTokens: 1_000,
    cacheWriteTokens: 0,
    outputTokens: 80,
    reasoningTokens: 30,
  },
  steps: 2,
  tools: [
    { name: 'get_order', startedAt: 1_800_000_000_900, durationMs: 300, outcome: 'ok' },
    { name: 'get_stock', startedAt: 1_800_000_000_900, durationMs: 5_000, outcome: 'timeout' },
  ],
};

const millis = ([seconds, nanos]: [number, number]): number => seconds * 1000 + nanos / 1e6;

describe('otelUsage', () => {
  it('records a turn as a chat span with GenAI attributes and its real times', () => {
    const { exporter, onUsage } = setup();
    onUsage(REPORT);
    const turn = exporter.getFinishedSpans().find((span) => span.name.startsWith('chat'));
    expect(turn?.name).toBe('chat test-model-2026');
    expect(turn?.kind).toBe(SpanKind.CLIENT);
    expect(millis(turn?.startTime ?? [0, 0])).toBe(REPORT.startedAt);
    expect(millis(turn?.endTime ?? [0, 0])).toBe(REPORT.startedAt + REPORT.durationMs);
    expect(turn?.attributes).toEqual({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'test-model-2026',
      'gen_ai.response.model': 'test-model-2026',
      'gen_ai.request.stream': true,
      'gen_ai.conversation.id': 'c0nv',
      'gen_ai.usage.input_tokens': 1_200,
      'gen_ai.usage.output_tokens': 80,
      'gen_ai.usage.cache_read.input_tokens': 1_000,
      'gen_ai.usage.reasoning.output_tokens': 30,
      'gen_ai.response.finish_reasons': ['stop'],
      'askdare.bot': 'support',
      'askdare.visitor': 'v1s1t0r',
      'askdare.outcome': 'completed',
      'askdare.steps': 2,
    });
    expect(turn?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('records each tool call as a child execute_tool span', () => {
    const { exporter, onUsage } = setup();
    onUsage(REPORT);
    const spans = exporter.getFinishedSpans();
    const turn = spans.find((span) => span.name.startsWith('chat'));
    const tools = spans.filter((span) => span.name.startsWith('execute_tool'));
    expect(tools.map((span) => span.name)).toEqual([
      'execute_tool get_order',
      'execute_tool get_stock',
    ]);
    for (const span of tools) {
      expect(span.kind).toBe(SpanKind.INTERNAL);
      expect(span.parentSpanContext?.spanId).toBe(turn?.spanContext().spanId);
      expect(span.spanContext().traceId).toBe(turn?.spanContext().traceId);
    }
    expect(tools[0]?.attributes).toEqual({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'get_order',
      'gen_ai.tool.type': 'function',
      'gen_ai.conversation.id': 'c0nv',
    });
    expect(tools[1]?.attributes['error.type']).toBe('timeout');
    expect(tools[1]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(millis(tools[1]?.endTime ?? [0, 0])).toBe(1_800_000_005_900);
  });

  it('marks a failed turn as an error and leaves out what it does not know', () => {
    const { exporter, onUsage } = setup();
    onUsage({
      ...REPORT,
      conversation: undefined,
      outcome: 'failed',
      finishReason: undefined,
      errorCode: 'upstream_error',
      usage: { ...REPORT.usage, cachedInputTokens: 0, reasoningTokens: 0 },
      tools: [],
    });
    const [turn] = exporter.getFinishedSpans();
    expect(turn?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'upstream_error' });
    expect(turn?.attributes['error.type']).toBe('upstream_error');
    for (const absent of [
      'gen_ai.conversation.id',
      'gen_ai.response.finish_reasons',
      'gen_ai.usage.cache_read.input_tokens',
      'gen_ai.usage.reasoning.output_tokens',
    ]) {
      expect(turn?.attributes).not.toHaveProperty(absent);
    }
  });

  it('uses the global tracer when none is given', () => {
    // Without a registered provider the API hands out a no-op tracer: nothing to record, no error.
    expect(() => otelUsage()(REPORT)).not.toThrow();
  });
});
