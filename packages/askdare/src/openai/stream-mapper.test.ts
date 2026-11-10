import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { describe, expect, it } from 'vitest';
import { CitationRegistry, ResponseStreamMapper } from './stream-mapper';

const added = (id: string, phase: 'commentary' | 'final_answer' | null): ResponseStreamEvent =>
  ({
    type: 'response.output_item.added',
    output_index: 0,
    sequence_number: 1,
    item: { type: 'message', id, role: 'assistant', status: 'in_progress', content: [], phase },
  }) as ResponseStreamEvent;

const completed = {
  type: 'response.completed',
  sequence_number: 9,
  response: { model: 'test-model-2026', usage: undefined, incomplete_details: null },
} as unknown as ResponseStreamEvent;

describe('ResponseStreamMapper', () => {
  it('takes the last visible message as the answer, never commentary', () => {
    const mapper = new ResponseStreamMapper('msg_local', () => {}, new CitationRegistry());
    mapper.handle(added('msg_final', 'final_answer'));
    mapper.handle(added('msg_note', 'commentary'));
    mapper.handle(completed);
    expect(mapper.outcome()).toMatchObject({
      answerItemId: 'msg_final',
      model: 'test-model-2026',
    });
  });

  it('has no answer when the step only called tools', () => {
    const mapper = new ResponseStreamMapper('msg_local', () => {}, new CitationRegistry());
    mapper.handle(completed);
    expect(mapper.outcome().answerItemId).toBeUndefined();
  });
});
