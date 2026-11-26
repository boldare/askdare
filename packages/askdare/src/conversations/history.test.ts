import { describe, expect, it } from 'vitest';
import { readSuggestedReplies, SUGGEST_REPLIES } from '../tools/suggest-replies';
import { settledAnswerItems } from './guard-notes';
import { historyFromItems } from './history';
import type { StoredItem } from './port';

const user: StoredItem = {
  id: 'itm_u',
  type: 'message',
  role: 'user',
  parts: [{ type: 'text', text: 'Hi' }],
};

/** The answer shape of GPT-5.4 and later with reply options: commentary, then only the options. */
const commentaryWithOptions: readonly StoredItem[] = [
  {
    id: 'itm_a',
    type: 'message',
    role: 'assistant',
    phase: 'commentary',
    parts: [{ type: 'text', text: 'Checked answer.' }],
  },
  {
    id: 'itm_c',
    type: 'call',
    callId: 'call_s',
    name: SUGGEST_REPLIES,
    arguments: JSON.stringify({ items: ['Yes', 'No'] }),
  },
  { id: 'itm_o', type: 'call_output', callId: 'call_s', output: '"shown"' },
];

const texts = (items: readonly StoredItem[], checked: boolean): string[] =>
  historyFromItems(items, { checked, replies: readSuggestedReplies }).map(
    (message) => message.text,
  );

describe('historyFromItems: a commentary answer before reply options (ADR-0022)', () => {
  it('shows it without output checks', () => {
    expect(texts([user, ...commentaryWithOptions], false)).toEqual(['Hi', 'Checked answer.']);
  });

  it('shows it with its options once a note allowed it', () => {
    const history = historyFromItems(
      [user, ...commentaryWithOptions, ...settledAnswerItems({ action: 'allowed' })],
      { checked: true, replies: readSuggestedReplies },
    );
    expect(history.map((message) => message.text)).toEqual(['Hi', 'Checked answer.']);
    expect(history.at(-1)?.replies).toEqual(['Yes', 'No']);
  });

  it('hides it when a note withheld it', () => {
    const withheld = [
      user,
      ...commentaryWithOptions,
      ...settledAnswerItems({ action: 'withheld' }),
    ];
    expect(texts(withheld, true)).toEqual(['Hi']);
    expect(texts(withheld, false)).toEqual(['Hi']);
  });

  it('hides it when no note settled it, with output checks', () => {
    expect(texts([user, ...commentaryWithOptions], true)).toEqual(['Hi']);
  });

  it('shows only the replacement, without the options, when a note replaced it', () => {
    const history = historyFromItems(
      [
        user,
        ...commentaryWithOptions,
        ...settledAnswerItems({ action: 'replaced', text: 'Safe.' }),
      ],
      { checked: true, replies: readSuggestedReplies },
    );
    expect(history.map((message) => message.text)).toEqual(['Hi', 'Safe.']);
    expect(history.at(-1)?.replies).toBeUndefined();
  });
});

describe('historyMessage citations', () => {
  it('keeps two sources of one text that share a title, and merges a source repeated in another part', () => {
    const [message] = historyFromItems(
      [
        {
          id: 'itm_a',
          type: 'message',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'Plans [1] and limits [2]. ',
              citations: [{ title: 'Pricing' }, { title: 'Pricing' }],
            },
            { type: 'text', text: 'Again [1].', citations: [{ title: 'Pricing' }] },
          ],
        },
      ],
      {},
    );
    expect(message?.citations).toEqual([
      { index: 1, title: 'Pricing', url: undefined },
      { index: 2, title: 'Pricing', url: undefined },
    ]);
  });
});
