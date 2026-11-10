// Runs with React aliased to Preact 11, as the iframe app is built (vitest.config.ts).
import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { createFixtureStore } from '../chat/fixture-store';
import { testConfig } from '../chat/testing/fake-server';
import { ChatProvider } from './context';
import { Composer, Input, Messages } from './headless';
import { DefaultPanel } from './skin';

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
});
