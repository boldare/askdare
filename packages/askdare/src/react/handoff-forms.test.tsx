// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatConfig } from '../chat/config';
import { createFixtureStore } from '../chat/fixture-store';
import type { ChatMessage, MessageForm } from '../chat/state';
import { fakeServer, testConfig } from '../chat/testing/fake-server';
import type { ProtocolEvent } from '../protocol/events';
import type { ChatForm } from '../protocol/forms';
import { ChatProvider } from './context';
import { Form, HandoffButton, HandoffStatus, MessageList, Root, useMessage } from './headless';
import { DefaultPanel } from './skin';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const contact: ChatForm = {
  name: 'contact',
  title: 'Get an offer',
  fields: [
    { name: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Anna' },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'phone', type: 'phone', label: 'Phone', required: false },
    {
      name: 'topic',
      type: 'select',
      label: 'Topic',
      required: false,
      options: [
        { value: 'pricing', label: 'Pricing' },
        { value: 'demo', label: 'A demo' },
      ],
    },
    { name: 'message', type: 'textarea', label: 'Message', required: false, maxLength: 10 },
    { name: 'consent', type: 'consent', label: 'I agree to be contacted.', required: true },
  ],
};

/** An answer with a form under it. */
const withForm =
  (purpose: MessageForm['purpose'] = 'lead', handoff?: 'requested') =>
  (): readonly ProtocolEvent[] => [
    { type: 'conversation.created', resumeToken: 'resume-1' },
    { type: 'message.start', messageId: 'msg_1' },
    { type: 'text.delta', messageId: 'msg_1', delta: 'Leave your details.' },
    ...(handoff ? [{ type: 'handoff', messageId: 'msg_1', state: handoff } as const] : []),
    {
      type: 'form',
      messageId: 'msg_1',
      callId: 'call_1',
      name: 'contact',
      handle: 'form-1',
      purpose,
    },
    { type: 'message.end', messageId: 'msg_1', reason: 'completed' },
  ];

async function chat(
  options: Parameters<typeof fakeServer>[0],
  config: Partial<ChatConfig> = {},
): Promise<ReturnType<typeof fakeServer>> {
  const server = fakeServer(options);
  vi.stubGlobal('fetch', server.fetch);
  render(
    <Root config={testConfig({ forms: [contact], ...config })}>
      <DefaultPanel />
    </Root>,
  );
  const field = screen.getByRole('textbox');
  fireEvent.change(field, { target: { value: 'Hi' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.keyDown(field, { key: 'Enter' });
  await screen.findByText('Leave your details.', {
    ignore: 'script, style, [data-ask-part="announcement"]',
  });
  return server;
}

const type = (name: string | RegExp, value: string): void => {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
};
const fill = (): void => {
  type(/^Name/, 'Anna');
  type(/^Email/, 'anna@example.com');
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to be contacted.' }));
};
function sendButton(): HTMLElement {
  const form = screen.getByRole('form', { name: 'Get an offer' });
  const button = form.querySelector<HTMLElement>('[data-ask-part="form-submit"]');
  if (!button) throw new Error('no submit button');
  return button;
}
const posted = (server: ReturnType<typeof fakeServer>, path: string) =>
  server.requests.filter((request) => request.path === path);

describe('Form', () => {
  it('draws every field with a visible label, and marks the optional ones', async () => {
    await chat(
      { answer: withForm() },
      {
        widget: {
          ...testConfig().widget,
          disclosure: { privacyUrl: 'https://example.com/privacy' },
        },
      },
    );
    const form = screen.getByRole('form', { name: 'Get an offer' });
    expect(form.getAttribute('data-ask-part')).toBe('form');
    expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('placeholder')).toBe('Anna');
    expect(screen.getByRole('textbox', { name: 'Email' }).getAttribute('autocomplete')).toBe(
      'email',
    );
    expect(screen.getByRole('textbox', { name: 'Phone (optional)' }).getAttribute('type')).toBe(
      'tel',
    );
    const topic = screen.getByRole('combobox', { name: 'Topic (optional)' });
    expect([...topic.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Choose…',
      'Pricing',
      'A demo',
    ]);
    expect(screen.getByRole('textbox', { name: 'Message (optional)' }).tagName).toBe('TEXTAREA');
    expect(screen.getByRole('checkbox', { name: 'I agree to be contacted.' })).toBeTruthy();
    const privacy = screen.getAllByRole('link', { name: 'Privacy policy' })[0] as HTMLElement;
    expect(privacy.closest('[data-type="consent"]')).toBeTruthy();
    expect(privacy.getAttribute('rel')).toContain('noopener');
  });

  it('checks the values by hand first: errors tied to their fields, the first one focused', async () => {
    const server = await chat({ answer: withForm(), submitForm: () => ({ state: 'sent' }) });
    fireEvent.click(sendButton());
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'This field is required.',
    );
    expect(document.activeElement).toBe(name);
    const consent = screen.getByRole('checkbox');
    expect(
      document.getElementById(consent.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Tick this box to continue.');
    expect(posted(server, '/forms')).toHaveLength(0);

    // Typing into a field clears its error.
    type('Name', 'Anna');
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    type('Email', 'anna@');
    type('Phone (optional)', '12ab');
    type('Message (optional)', 'far too long');
    fireEvent.click(sendButton());
    const errors = [...document.querySelectorAll('[data-ask-part="form-error"]')].map(
      (error) => error.textContent,
    );
    expect(errors).toEqual([
      'Enter a valid email address.',
      'Enter a valid phone number.',
      'Use at most 10 characters.',
      'Tick this box to continue.',
    ]);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));
  });

  it('sends the values once, then shows its done text and moves focus there', async () => {
    const server = await chat({ answer: withForm(), submitForm: () => ({ state: 'sent' }) });
    fill();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'demo' } });
    fireEvent.click(sendButton());
    const done = await screen.findByText('Thanks! We’ve received your details.');
    expect(done.getAttribute('data-ask-part')).toBe('form-done');
    expect(done.getAttribute('role')).toBe('status');
    await waitFor(() => expect(document.activeElement).toBe(done));
    expect(screen.queryByRole('form', { name: 'Get an offer' })).toBeNull();
    expect(posted(server, '/forms').map((request) => request.body)).toEqual([
      expect.objectContaining({
        form: 'form-1',
        values: {
          name: 'Anna',
          email: 'anna@example.com',
          phone: '',
          topic: 'demo',
          message: '',
          consent: true,
        },
      }),
    ]);
  });

  it("shows the server's field errors and focuses the first, a generic one for an unknown key", async () => {
    await chat({
      answer: withForm(),
      submitForm: () =>
        Response.json(
          {
            error: {
              code: 'invalid_input',
              message: 'The request was invalid.',
              fields: { email: 'error.form.email', name: 'error.form.fromTheFuture' },
            },
          },
          { status: 400 },
        ),
    });
    fill();
    fireEvent.click(sendButton());
    const name = screen.getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'));
    expect(document.activeElement).toBe(name);
    expect(document.getElementById(name.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'This contains characters that can’t be accepted.',
    );
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('announces a failure of the whole form and keeps the values to try again', async () => {
    await chat({
      answer: withForm(),
      submitForm: () =>
        Response.json({ error: { code: 'internal_error', message: 'x' } }, { status: 500 }),
    });
    fill();
    fireEvent.click(sendButton());
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-ask-part')).toBe('form-error');
    expect((screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement).value).toBe(
      'anna@example.com',
    );
  });

  it('says when a form can no longer be sent', async () => {
    await chat({
      answer: withForm(),
      submitForm: () => Response.json({ error: { code: 'not_found' } }, { status: 404 }),
    });
    fill();
    fireEvent.click(sendButton());
    expect(await screen.findByText('This form is no longer available.')).toBeTruthy();
  });

  it("shows a handoff form's outcome with the reply address", async () => {
    await chat({
      answer: withForm('handoff', 'requested'),
      submitForm: () => ({ state: 'sent', handoff: 'sent' }),
    });
    // The form says what happens; no "Connecting you…" line beside it.
    expect(screen.queryByText('Connecting you with a person…')).toBeNull();
    fill();
    fireEvent.click(sendButton());
    expect(
      await screen.findByText(
        'Done. A person from our team will get back to you at anna@example.com.',
      ),
    ).toBeTruthy();
  });

  it('titles a message left while nobody is available, then says it was saved', async () => {
    await chat({
      answer: withForm('message', 'requested'),
      submitForm: () => ({ state: 'sent', handoff: 'saved' }),
    });
    const form = screen.getByRole('form', {
      name: 'Nobody is available right now. Leave a message and we’ll reply by email.',
    });
    expect(form.getAttribute('data-purpose')).toBe('message');
    fill();
    fireEvent.click(form.querySelector('button') as HTMLElement);
    expect(
      await screen.findByText('We’ve saved your message. A person will reply by email.'),
    ).toBeTruthy();
  });

  it('takes a field called constructor, and renders text, never markup', () => {
    const odd: ChatForm = {
      name: 'odd',
      title: '<b>Odd</b>',
      fields: [{ name: 'constructor', type: 'text', label: '<i>Label</i>', required: true }],
    };
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      text: 'Hi',
      citations: [],
      attachments: 0,
      status: 'done',
      forms: [{ callId: 'c1', name: 'odd', purpose: 'lead', state: 'open', handle: 'h' }],
    };
    render(
      <ChatProvider
        store={createFixtureStore(testConfig({ forms: [odd] }), { messages: [message] })}
      >
        <MessageList>
          <Forms />
        </MessageList>
      </ChatProvider>,
    );
    const field = screen.getByRole('textbox', { name: '<i>Label</i>' }) as HTMLInputElement;
    expect(field.value).toBe('');
    expect(screen.getByRole('form', { name: '<b>Odd</b>' }).querySelector('b')).toBeNull();
    fireEvent.submit(field.form as HTMLFormElement);
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('renders nothing for a form the configuration no longer has, and the state of closed ones', () => {
    const forms: MessageForm[] = [
      { callId: 'c1', name: 'gone', purpose: 'lead', state: 'open', handle: 'h' },
      { callId: 'c2', name: 'contact', purpose: 'lead', state: 'sent' },
      { callId: 'c3', name: 'contact', purpose: 'lead', state: 'expired' },
    ];
    const message: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      text: 'Hi',
      citations: [],
      attachments: 0,
      status: 'done',
      forms,
    };
    render(
      <ChatProvider
        store={createFixtureStore(testConfig({ forms: [{ ...contact, done: 'Thanks, Anna!' }] }), {
          messages: [message],
        })}
      >
        <MessageList>
          <Forms />
        </MessageList>
      </ChatProvider>,
    );
    expect(document.querySelectorAll('[data-ask-part="form"]')).toHaveLength(0);
    expect(
      [...document.querySelectorAll('[data-ask-part="form-done"]')].map((done) => done.textContent),
    ).toEqual(['Thanks, Anna!', 'This form is no longer available.']);
    // Restored from history: nothing takes focus.
    expect(document.activeElement).toBe(document.body);
  });
});

function Forms() {
  const { forms } = useMessage();
  return (
    <>
      {forms?.map((form) => (
        <Form key={form.callId} form={form} />
      ))}
    </>
  );
}

describe('HandoffButton and HandoffStatus', () => {
  it('shows nothing for a bot without the button, or before the first answer', async () => {
    const server = fakeServer({});
    vi.stubGlobal('fetch', server.fetch);
    const { rerender } = render(
      <Root config={testConfig({ handoff: true })}>
        <HandoffButton />
      </Root>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <ChatProvider
        store={createFixtureStore(testConfig(), {
          messages: [
            {
              id: 'a1',
              role: 'assistant',
              text: 'Hi',
              citations: [],
              attachments: 0,
              status: 'done',
            },
          ],
        })}
      >
        <HandoffButton />
      </ChatProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks for a person for the latest answer and shows how it went', async () => {
    let answer = (): void => {};
    const server = await chat(
      {
        answer: () => [
          { type: 'conversation.created', resumeToken: 'resume-1' },
          { type: 'message.start', messageId: 'msg_1' },
          { type: 'text.delta', messageId: 'msg_1', delta: 'Leave your details.' },
          { type: 'message.end', messageId: 'msg_1', reason: 'completed' },
        ],
        handoff: () =>
          new Promise((resolve) => {
            answer = () => resolve({ state: 'sent' });
          }),
      },
      { handoff: true },
    );
    const button = screen.getByRole('button', { name: 'Talk to a person' });
    expect(button.getAttribute('data-ask-part')).toBe('handoff');
    button.focus();
    fireEvent.click(button);
    const status = await screen.findByText('Connecting you with a person…');
    expect(status.getAttribute('role')).toBe('status');
    // Keeps focus while the request runs; a second click does nothing.
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    answer();
    const done = await screen.findByText(
      'Done. A person from our team will get back to you by email.',
    );
    // The same live region, so the outcome is announced.
    expect(done).toBe(status);
    expect(done.getAttribute('data-state')).toBe('sent');
    expect(posted(server, '/handoff')).toHaveLength(1);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
  });

  it('shows the form a handoff asks for, in place of the status', async () => {
    await chat(
      {
        answer: () => [
          { type: 'conversation.created', resumeToken: 'resume-1' },
          { type: 'message.start', messageId: 'msg_1' },
          { type: 'text.delta', messageId: 'msg_1', delta: 'Leave your details.' },
          { type: 'message.end', messageId: 'msg_1', reason: 'completed' },
        ],
        handoff: () => ({
          state: 'requested',
          form: { name: 'contact', handle: 'form-9', purpose: 'handoff' },
        }),
      },
      { handoff: true },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Talk to a person' }));
    expect(await screen.findByRole('form', { name: 'Get an offer' })).toBeTruthy();
    expect(screen.queryByText('Connecting you with a person…')).toBeNull();
  });

  it.each([
    ['unavailable', 'Nobody is available right now. Please try again later.'],
    ['failed', 'We couldn’t reach the team right now. Please try again later.'],
    ['limited', 'You’ve already asked for a person. They’ll get back to you.'],
    ['saved', 'We’ve saved your message. A person will reply by email.'],
  ] as const)('says when a handoff is %s', (state, text) => {
    render(
      <ChatProvider
        store={createFixtureStore(testConfig(), {
          messages: [
            {
              id: 'a1',
              role: 'assistant',
              text: '',
              citations: [],
              attachments: 0,
              status: 'done',
              handoff: state,
            },
          ],
        })}
      >
        <MessageList>
          <HandoffStatus />
        </MessageList>
      </ChatProvider>,
    );
    expect(screen.getByText(text).getAttribute('data-state')).toBe(state);
  });
});
