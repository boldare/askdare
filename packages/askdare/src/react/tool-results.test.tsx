// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixtureStore } from '../chat/fixture-store';
import type { ChatMessage } from '../chat/state';
import { echo, fakeServer, testConfig } from '../chat/testing/fake-server';
import { ChatProvider } from './context';
import {
  Link,
  MessageList,
  Root,
  type ToolRendererProps,
  type ToolRenderers,
  ToolResults,
  useChat,
} from './headless';
import { DefaultPanel } from './skin';
import { ToolRenderersProvider } from './tool-results';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const answer = (ui: ChatMessage['ui']): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  text: 'Two slots are free.',
  citations: [],
  attachments: 0,
  status: 'done',
  ...(ui ? { ui } : {}),
});

/** A tool's type as a page sees it through `import type`. */
interface FindSlots {
  readonly name: 'find_slots';
  readonly ui?: (output: unknown) => { readonly slots: readonly string[] } | undefined;
}

function SlotList({ data, name, callId }: ToolRendererProps<FindSlots>): ReactElement {
  const { actions } = useChat();
  return (
    <ul data-testid={`${name}:${callId}`}>
      {data.slots.map((slot) => (
        <li key={slot}>
          <button type="button" onClick={() => void actions.send(`Book ${slot}`)}>
            {slot}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Broken(): ReactElement {
  throw new Error('bad card');
}

function Title({ data }: ToolRendererProps): ReactElement {
  const { title, url } = data as { title: string; url: string };
  return (
    <p>
      {title} <Link href={url}>{title}</Link>
    </p>
  );
}

function show(messages: readonly ChatMessage[], renderers?: ToolRenderers): void {
  render(
    <ChatProvider store={createFixtureStore(testConfig(), { messages })}>
      <ToolRenderersProvider renderers={renderers}>
        <MessageList>
          <ToolResults data-testid="cards" />
        </MessageList>
      </ToolRenderersProvider>
    </ChatProvider>,
  );
}

describe('ToolResults', () => {
  it("draws each payload with its tool's component, in call order", () => {
    show(
      [
        answer([
          { callId: 'c1', name: 'find_slots', data: { slots: ['9:00'] } },
          { callId: 'c2', name: 'find_slots', data: { slots: ['11:00', '13:00'] } },
        ]),
      ],
      { find_slots: SlotList },
    );
    const group = screen.getByTestId('cards');
    expect(group.getAttribute('data-ask-part')).toBe('tool-results');
    const cards = group.querySelectorAll('[data-ask-part="tool-result"]');
    expect([...cards].map((card) => card.getAttribute('data-ask-tool'))).toEqual([
      'find_slots',
      'find_slots',
    ]);
    expect(screen.getByTestId('find_slots:c1').textContent).toBe('9:00');
    expect(screen.getByTestId('find_slots:c2').textContent).toBe('11:0013:00');
  });

  it('shows nothing for a tool without a component, and says so once when toolRenderers is set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknown = answer([{ callId: 'c9', name: 'lookup_order_xyz', data: { id: 1 } }]);
    show([unknown]);
    expect(screen.queryByTestId('cards')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    cleanup();
    show([unknown, { ...unknown, id: 'a2' }], { find_slots: SlotList });
    expect(screen.queryByTestId('cards')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('"lookup_order_xyz"');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('"id"');
  });

  it("never takes a component from the map's prototype", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    show([answer([{ callId: 'c1', name: 'constructor', data: {} }])], { find_slots: SlotList });
    expect(screen.queryByTestId('cards')).toBeNull();
  });

  it('leaves out a card whose component throws, and keeps the rest of the chat', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ChatProvider
        store={createFixtureStore(testConfig(), {
          messages: [
            answer([
              { callId: 'c1', name: 'broken', data: {} },
              { callId: 'c2', name: 'find_slots', data: { slots: ['9:00'] } },
            ]),
          ],
        })}
      >
        <ToolRenderersProvider renderers={{ broken: Broken, find_slots: SlotList }}>
          <DefaultPanel />
        </ToolRenderersProvider>
      </ChatProvider>,
    );
    expect(screen.getByText('Two slots are free.')).toBeTruthy();
    expect(screen.getByTestId('find_slots:c2')).toBeTruthy();
    expect(document.querySelector('[data-ask-tool="broken"]')?.textContent).toBe('');
    expect(error.mock.calls.some((args) => String(args[0]).includes('tool "broken" failed'))).toBe(
      true,
    );
  });

  it('renders hostile strings in a payload as text', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    show(
      [
        answer([
          { callId: 'c1', name: 'title', data: { title: hostile, url: 'javascript:alert(3)' } },
        ]),
      ],
      {
        title: Title,
      },
    );
    const cards = screen.getByTestId('cards');
    expect(cards.querySelector('img, script, a')).toBeNull();
    expect(cards.textContent).toContain(hostile);
  });
});

describe('Link', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['mailto:help@example.com', 'mailto:help@example.com'],
  ])('links %s in a new tab', (href, expected) => {
    render(<Link href={href}>Open</Link>);
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.getAttribute('href')).toBe(expected);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it.each([
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/relative',
    'tel:123',
  ])('renders %s as text only', (href) => {
    render(
      <Link href={href} className="cta">
        Open
      </Link>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Open').className).toBe('cta');
  });
});

describe('toolRenderers on Root', () => {
  const card = { callId: 'c1', name: 'find_slots', data: { slots: ['9:00'] } };

  it('shows a card live under the answer, and a click in it sends a visitor message', async () => {
    const server = fakeServer({
      answer: (text) =>
        text === 'Book a call'
          ? [
              ...echo(text).slice(0, 2),
              { type: 'tool.ui', messageId: 'msg_1', ...card },
              ...echo(text).slice(2),
            ]
          : echo(text).map((event) =>
              'messageId' in event ? { ...event, messageId: 'msg_2' } : event,
            ),
    });
    vi.stubGlobal('fetch', server.fetch);
    render(
      <Root config={testConfig()} toolRenderers={{ find_slots: SlotList }}>
        <DefaultPanel />
      </Root>,
    );
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Book a call' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    const slot = await screen.findByRole('button', { name: '9:00' });
    expect(slot.closest('[data-role="assistant"]')).toBeTruthy();
    fireEvent.click(slot);
    await screen.findByText('You said: Book 9:00');
    const sent = server.requests.filter((request) => request.path === '/messages');
    expect(sent.at(-1)?.body['text']).toBe('Book 9:00');
  });

  it('brings the card back from history after a reload', async () => {
    localStorage.setItem('askdare:support:resume', 'resume-1');
    const server = fakeServer({
      history: [
        { id: 'u1', role: 'user', text: 'Book a call', citations: [], attachments: 0 },
        { id: 'a1', role: 'assistant', text: 'Here.', citations: [], attachments: 0, ui: [card] },
      ],
    });
    vi.stubGlobal('fetch', server.fetch);
    render(
      <Root config={testConfig()} toolRenderers={{ find_slots: SlotList }}>
        <DefaultPanel />
      </Root>,
    );
    expect(await screen.findByTestId('find_slots:c1')).toBeTruthy();
  });
});
