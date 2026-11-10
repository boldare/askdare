// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixtureStore } from '../chat/fixture-store';
import { fakeServer, testConfig } from '../chat/testing/fake-server';
import { ChatProvider } from './context';
import {
  Citations,
  Composer,
  Input,
  Message,
  MessageList,
  Messages,
  MessageText,
  Root,
  Send,
  useChat,
  useMessage,
} from './headless';
import { DefaultPanel } from './skin';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Root and the default look', () => {
  it('chats: the welcome, a sent message and its answer', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    render(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    expect(screen.getByRole('region', { name: 'Brightloop assistant' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Brightloop assistant' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Hi! How can I help?' })).toBeTruthy();

    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Hello' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('You said: Hello');
    expect(document.querySelectorAll('[data-ask-part="message"]')).toHaveLength(2);
  });

  it('rates an answer and asks what went wrong after a 👎', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    render(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Hello' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    const group = await screen.findByRole('group', { name: 'Rate this answer' });
    expect(group.parentElement?.closest('[data-role="assistant"]')).toBeTruthy();
    const down = screen.getByRole('button', { name: 'Not helpful' });
    expect(down.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(down);
    const comment = await screen.findByLabelText('What went wrong?');
    expect(down.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(comment));
    fireEvent.change(comment, { target: { value: 'Too vague' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(screen.queryByLabelText('What went wrong?')).toBeNull());
    const ratings = server.requests.filter((request) => request.path === '/feedback');
    expect(ratings.at(-1)?.body).toMatchObject({ rating: 'down', comment: 'Too vague' });

    // A second click on the pressed button takes the rating back.
    fireEvent.click(down);
    await waitFor(() => expect(down.getAttribute('aria-pressed')).toBe('false'));
    expect(screen.queryByLabelText('What went wrong?')).toBeNull();
  });

  it('takes the page greeting and starters from its props', () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    render(
      <Root
        config={testConfig()}
        greeting="Questions about prices?"
        starters={['  Is there a trial?  ']}
      >
        <DefaultPanel />
      </Root>,
    );
    expect(screen.getByRole('heading', { name: 'Questions about prices?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Is there a trial?' })).toBeTruthy();
  });

  it('starts another chat when the config changes', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const view = render(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    const other = testConfig();
    view.rerender(
      <Root config={{ ...other, botId: 'sales', widget: { ...other.widget, title: 'Sales' } }}>
        <DefaultPanel />
      </Root>,
    );
    expect(await screen.findByRole('region', { name: 'Sales' })).toBeTruthy();
  });

  it('closes on Escape only when it is pressed in the chat', () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Outside</button>
        <Root config={testConfig()}>
          <DefaultPanel onClose={onClose} />
        </Root>
      </>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Outside' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves Escape outside the chat to the page, even as the main landmark', () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Outside</button>
        <Root config={testConfig()}>
          <DefaultPanel headingLevel={1} onClose={onClose} />
        </Root>
      </>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Outside' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    // A handler that already used Escape keeps it.
    const field = screen.getByRole('textbox');
    field.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape anywhere when the chat is the whole document', () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Outside</button>
        <Root config={testConfig()}>
          <DefaultPanel headingLevel={1} onClose={onClose} ownsDocument />
        </Root>
      </>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Outside' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('asks before starting over, modal only when the chat is the whole document', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const ask = async (ownsDocument: boolean): Promise<HTMLElement> => {
      render(
        <Root config={testConfig()}>
          <DefaultPanel ownsDocument={ownsDocument} />
        </Root>,
      );
      const field = screen.getByRole('textbox');
      fireEvent.change(field, { target: { value: 'Hello' } });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
      );
      fireEvent.keyDown(field, { key: 'Enter' });
      fireEvent.click(await screen.findByRole('button', { name: 'Start a new conversation' }));
      return screen.getByRole('alertdialog');
    };
    // Inside a page, the page around the chat stays usable.
    expect((await ask(false)).hasAttribute('aria-modal')).toBe(false);
    cleanup();
    localStorage.clear();
    expect((await ask(true)).getAttribute('aria-modal')).toBe('true');
  });

  it('returns focus to the field after an answer, but never from the page', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    render(
      <>
        <input aria-label="Newsletter" />
        <Root config={testConfig()}>
          <DefaultPanel />
        </Root>
      </>,
    );
    const field = screen.getByRole('textbox', { name: 'Ask anything' });
    field.focus();
    fireEvent.change(field, { target: { value: 'Hello' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    // The visitor moves on to the page's own form while the answer streams.
    const newsletter = screen.getByRole('textbox', { name: 'Newsletter' });
    newsletter.focus();
    await screen.findByText('You said: Hello');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true),
    );
    expect(document.activeElement).toBe(newsletter);

    // From inside the chat, focus comes back to the field.
    fireEvent.change(field, { target: { value: 'Again' } });
    const button = screen.getByRole('button', { name: 'Send' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    button.focus();
    fireEvent.click(button);
    await screen.findByText('You said: Again');
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('refuses a basePath on another origin', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<Root config={testConfig({ basePath: 'https://evil.example/api/chat' })} />),
    ).toThrow(/must be a path on this app/);
  });

  it('refuses stylesheets from anywhere but the chat route', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const styles = { theme: '/api/chat/theme/support.css', fonts: '/api/chat/assets/f.css' };
    for (const skin of [
      'https://evil.example/skin.css',
      '/other/skin.css',
      '/api/chat//evil.example/x.css',
    ]) {
      expect(() => render(<Root config={testConfig({ styles: { ...styles, skin } })} />)).toThrow(
        /stylesheets must come from/,
      );
    }
  });

  it('renders on the server without storage or network', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const html = renderToString(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    expect(html).toContain('data-ask-part="welcome"');
    expect(html).toContain('Hi! How can I help?');
    expect(fetch).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });
});

function Role() {
  return <span data-testid="role">{useMessage().role}</span>;
}

function Draft() {
  const { state, actions, bot, t } = useChat();
  return (
    <button type="button" onClick={() => actions.setDraft('Changed')}>
      {`${state.draft} · ${bot.title} · ${t('composer.send')}`}
    </button>
  );
}

describe('primitives', () => {
  const store = () =>
    createFixtureStore(testConfig(), {
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          text: 'See the sources.',
          citations: [
            { index: 1, title: 'Pricing', url: 'https://example.com/pricing' },
            { index: 2, title: 'Injected', url: 'javascript:alert(1)' },
          ],
          attachments: 0,
          status: 'done',
        },
      ],
      draft: 'Draft',
    });

  it('pass native props and refs to their element', () => {
    const log = createRef<HTMLDivElement>();
    const field = createRef<HTMLTextAreaElement>();
    render(
      <ChatProvider store={store()}>
        <Messages ref={log} className="my-log" />
        <Composer>
          <Input ref={field} id="question" />
          <Send>Go</Send>
        </Composer>
      </ChatProvider>,
    );
    expect(log.current?.getAttribute('data-ask-part')).toBe('messages');
    expect(log.current?.className).toBe('my-log');
    expect(field.current?.id).toBe('question');
    expect(field.current?.value).toBe('Draft');
  });

  it('let your handlers take over sending and pasting', async () => {
    const sendSpy = vi.fn();
    const chat = store();
    const send = vi.spyOn(chat.actions, 'send').mockImplementation(async () => sendSpy());
    const addFiles = vi.spyOn(chat.actions, 'addFiles');
    const onSubmit = vi.fn();
    let takeOver = true;
    render(
      <ChatProvider store={chat}>
        <Composer
          onSubmit={(event) => {
            onSubmit();
            if (takeOver) event.preventDefault();
          }}
        >
          <Input onPaste={(event) => event.preventDefault()} />
          <Send>Go</Send>
        </Composer>
      </ChatProvider>,
    );
    const field = screen.getByRole('textbox');
    // Enter goes through the form, so onSubmit sees it like the button.
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    takeOver = false;
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(sendSpy).toHaveBeenCalledOnce());

    fireEvent.paste(field, {
      clipboardData: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] },
    });
    expect(addFiles).not.toHaveBeenCalled();
  });

  it('render each message with useMessage(), and check citation links', () => {
    render(
      <ChatProvider store={store()}>
        <MessageList>
          <Message>
            <Role />
            <MessageText />
            <Citations />
          </Message>
        </MessageList>
      </ChatProvider>,
    );
    expect(screen.getByTestId('role').textContent).toBe('assistant');
    expect(screen.getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe(
      'https://example.com/pricing',
    );
    expect(screen.queryByRole('link', { name: 'Injected' })).toBeNull();
    expect(screen.getByText('Injected').tagName).toBe('SPAN');
  });

  it('give useChat() the state, actions, bot and texts', async () => {
    render(
      <ChatProvider store={store()}>
        <Draft />
      </ChatProvider>,
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('Draft · Brightloop assistant · Send');
    await act(async () => fireEvent.click(button));
    expect(button.textContent).toBe('Changed · Brightloop assistant · Send');
  });

  it('say clearly when they are outside Root', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Messages />)).toThrow('[askdare] Chat components must be inside <Root>.');
  });
});
