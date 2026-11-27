// Runs with React aliased to Preact 11, as the iframe app is built (vitest.config.ts).
import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { createFixtureStore } from '../chat/fixture-store';
import { testConfig } from '../chat/testing/fake-server';
import { ChatProvider } from './context';
import {
  Composer,
  Form,
  HandoffStatus,
  Input,
  Link,
  LoadEarlier,
  MessageList,
  Messages,
  ToolResults,
  useMessage,
} from './headless';
import { DefaultPanel } from './skin';
import { ToolRenderersProvider } from './tool-results';

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The current message's forms. */
const Forms = () => {
  const { forms } = useMessage();
  return (
    <>
      {forms?.map((form) => (
        <Form key={form.callId} form={form} />
      ))}
    </>
  );
};

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

  it('show LoadEarlier while the conversation has older messages, with its ref', async () => {
    const button = createRef<HTMLButtonElement>();
    const container = document.createElement('div');
    const message = { citations: [], attachments: 0, status: 'done' } as const;
    createRoot(container).render(
      <ChatProvider
        store={createFixtureStore(testConfig(), {
          messages: [{ ...message, id: 'm1', role: 'user', text: 'Hi' }],
          earlier: 'loading',
        })}
      >
        <Messages>
          <LoadEarlier ref={button} />
        </Messages>
      </ChatProvider>,
    );
    await settled();
    expect(button.current?.getAttribute('data-ask-part')).toBe('load-earlier');
    expect(button.current?.textContent).toBe('Loading earlier messages…');
    expect(button.current?.getAttribute('aria-disabled')).toBe('true');
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

  it('draw a form and check it by hand, and a handoff status', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    createRoot(container).render(
      <ChatProvider
        store={createFixtureStore(
          testConfig({
            forms: [
              {
                name: 'contact',
                title: 'Get an offer',
                fields: [
                  { name: 'email', type: 'email', label: 'Email', required: true },
                  {
                    name: 'topic',
                    type: 'select',
                    label: 'Topic',
                    required: false,
                    options: [
                      { value: 'a', label: 'A' },
                      { value: 'b', label: 'B' },
                    ],
                  },
                  { name: 'consent', type: 'consent', label: 'I agree', required: true },
                ],
              },
            ],
          }),
          {
            messages: [
              {
                id: 'a1',
                role: 'assistant',
                text: 'Hi',
                citations: [],
                attachments: 0,
                status: 'done',
                handoff: 'sent',
                forms: [
                  { callId: 'c1', name: 'contact', purpose: 'lead', state: 'open', handle: 'h' },
                ],
              },
            ],
          },
        )}
      >
        <MessageList>
          <HandoffStatus />
          <Forms />
        </MessageList>
      </ChatProvider>,
    );
    await settled();
    const form = container.querySelector('form');
    expect(form?.getAttribute('data-ask-part')).toBe('form');
    expect(container.querySelectorAll('select option')).toHaveLength(3);
    expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(container.querySelector('[data-ask-part="handoff-status"]')?.textContent).toBe(
      'Done. A person from our team will get back to you by email.',
    );
    form?.querySelector('button')?.click();
    await settled();
    const email = container.querySelector('input[type="email"]');
    expect(email?.getAttribute('aria-invalid')).toBe('true');
    expect(container.ownerDocument.activeElement).toBe(email);
    container.remove();
  });
});
