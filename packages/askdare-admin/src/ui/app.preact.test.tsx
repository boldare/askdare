import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import { App } from './app';
import type { DashboardHost } from './host';

const answers: Record<string, unknown> = {
  days: {
    from: '2026-11-24',
    to: '2026-11-25',
    bots: ['support'],
    models: [],
    days: [],
    totals: {
      turns: 0,
      failed: 0,
      unanswered: 0,
      conversations: 0,
      up: 0,
      down: 0,
      leads: 0,
      handoffs: 0,
      resolution: null,
      tokens: { input: 0, cachedInput: 0, output: 0 },
      cost: 0,
      unpriced: [],
    },
  },
  ratings: {
    items: [
      { ref: 'r1', bot: 'support', at: 0, rating: 'down', comment: '<img src=x onerror=alert(1)>' },
    ],
  },
  transcript: {
    turns: [
      {
        at: 0,
        input: '<script>x</script>',
        attachments: 0,
        answer: '<b>hi</b>',
        citations: [],
        reason: 'completed',
      },
    ],
  },
};

const host: DashboardHost = { call: async (action) => answers[action] };
const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
const click = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')]
    .find((button) => button.textContent?.includes(label))
    ?.click();

describe('dashboard app', () => {
  it('renders comments and transcripts as text, never HTML', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => render(<App host={host} />, root));
    await flush();
    expect(root.textContent).toContain('Unanswered questions');
    await act(() => click(root, '👎 answers'));
    await flush();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelector('img')).toBeNull();
    await act(() => click(root, 'Review'));
    await flush();
    expect(root.textContent).toContain('<script>x</script>');
    expect(root.textContent).toContain('<b>hi</b>');
    expect(root.querySelector('script, b')).toBeNull();
    render(null, root);
  });
});
