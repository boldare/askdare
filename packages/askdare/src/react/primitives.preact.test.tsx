// Runs with React aliased to Preact 11, as the iframe app is built (vitest.config.ts).
import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { createFixtureStore } from '../chat/fixture-store';
import { testConfig } from '../chat/testing/fake-server';
import { ChatProvider } from './context';
import { Composer, Input, Link, MessageList, Messages, ToolResults } from './headless';
import { DefaultPanel } from './skin';
import { ToolRenderersProvider } from './tool-results';

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const Broken = (): never => {
  throw new Error('bad card');
};
const Card = ({ data }: { readonly data: never }) => (
  <Link href={(data as { url: string }).url}>{(data as { title: string }).title}</Link>
);

describe('primitives under Preact', () => {
  it('get ref as a prop, without forwardRef', async () => {
    const log = createRef<HTMLDivElement>();
    const field = createRef<HTMLTextAreaElement>();
    const container = document.createElement('div');
    createRoot(container).render(
      <ChatProvider store={createFixtureStore(testConfig(), { messages: [], draft: 'Hi' })}>
        <Messages ref={log} />
        <Composer>
          <Input ref={field} />
        </Composer>
      </ChatProvider>,
    );
    await settled();
    expect(log.current?.getAttribute('data-ask-part')).toBe('messages');
    expect(field.current?.value).toBe('Hi');
  });

  it('render the default look', async () => {
    const container = document.createElement('div');
    createRoot(container).render(
      <ChatProvider store={createFixtureStore(testConfig(), { messages: [] })}>
        <DefaultPanel headingLevel={1} />
      </ChatProvider>,
    );
    await settled();
    expect(container.querySelector('main[data-ask-part="panel"] h1')?.textContent).toBe(
      'Brightloop assistant',
    );
    expect(container.querySelector('[data-ask-part="welcome"] h2')?.textContent).toBe(
      'Hi! How can I help?',
    );
  });

  it('draw tool cards, leave out one that throws, and check links', async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args[0]);
    const container = document.createElement('div');
    createRoot(container).render(
      <ChatProvider
        store={createFixtureStore(testConfig(), {
          messages: [
            {
              id: 'a1',
              role: 'assistant',
              text: 'Two.',
              citations: [],
              attachments: 0,
              status: 'done',
              ui: [
                { callId: 'c1', name: 'broken', data: {} },
                {
                  callId: 'c2',
                  name: 'card',
                  data: { title: 'Safe', url: 'https://example.com/' },
                },
                {
                  callId: 'c3',
                  name: 'card',
                  data: { title: 'Unsafe', url: 'javascript:alert(1)' },
                },
              ],
            },
          ],
        })}
      >
        <ToolRenderersProvider renderers={{ broken: Broken, card: Card }}>
          <MessageList>
            <ToolResults />
          </MessageList>
        </ToolRenderersProvider>
      </ChatProvider>,
    );
    await settled();
    await settled();
    console.error = original;
    const cards = container.querySelectorAll('[data-ask-part="tool-result"]');
    expect(cards).toHaveLength(3);
    expect(cards[0]?.textContent).toBe('');
    expect(cards[1]?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/');
    expect(cards[2]?.querySelector('a')).toBeNull();
    expect(cards[2]?.textContent).toBe('Unsafe');
    expect(errors.some((message) => String(message).includes('tool "broken" failed'))).toBe(true);
  });
});
