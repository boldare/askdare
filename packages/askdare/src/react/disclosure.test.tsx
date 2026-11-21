// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatConfig } from '../chat/config';
import { fakeServer, testConfig } from '../chat/testing/fake-server';
import { Disclosure, Input, Root } from './headless';
import { DefaultPanel } from './skin';

const withDisclosure = (disclosure: ChatConfig['widget']['disclosure']): ChatConfig => {
  const config = testConfig();
  return { ...config, widget: { ...config.widget, disclosure } };
};

const warn = vi.fn();
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', fakeServer().fetch);
  warn.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(warn);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const notes = (): unknown[][] =>
  warn.mock.calls.filter((call) => String(call[0]).includes('<Disclosure />'));

describe('Disclosure', () => {
  it('says the visitor talks to an AI', () => {
    render(
      <Root config={testConfig()}>
        <Disclosure className="note" />
      </Root>,
    );
    const note = screen.getByText('You’re chatting with an AI assistant. It can make mistakes.');
    expect(note.getAttribute('data-ask-part')).toBe('disclosure');
    expect(note.className).toBe('note');
    expect(note.querySelector('a')).toBeNull();
  });

  it('links the privacy policy when the bot has one', () => {
    render(
      <Root config={withDisclosure({ privacyUrl: 'https://www.example.com/privacy' })}>
        <Disclosure />
      </Root>,
    );
    const link = screen.getByRole('link', { name: 'Privacy policy' });
    expect(link.getAttribute('href')).toBe('https://www.example.com/privacy');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('takes your own notice as children', () => {
    render(
      <Root config={testConfig()}>
        <Disclosure>Answers come from an AI.</Disclosure>
      </Root>,
    );
    expect(screen.getByText('Answers come from an AI.').getAttribute('data-ask-part')).toBe(
      'disclosure',
    );
  });

  it('renders nothing with disclosure: false', () => {
    const { container } = render(
      <Root config={withDisclosure(false)}>
        <Disclosure>Answers come from an AI.</Disclosure>
      </Root>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('is in the default look', () => {
    render(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    expect(document.querySelector('[data-ask-part="disclosure"]')?.textContent).toContain(
      'AI assistant',
    );
    expect(notes()).toHaveLength(0);
  });
});

describe('the development note', () => {
  it('notes once when the chat renders no Disclosure', () => {
    render(
      <StrictMode>
        <Root config={testConfig()}>
          <Input />
        </Root>
      </StrictMode>,
    );
    expect(notes()).toHaveLength(1);
    expect(String(notes()[0]?.[0])).toContain('art. 50');
  });

  it('stays quiet with a Disclosure, wherever it is', () => {
    render(
      <Root config={testConfig()}>
        <div>
          <Input />
          <Disclosure>Answers come from an AI.</Disclosure>
        </div>
      </Root>,
    );
    expect(notes()).toHaveLength(0);
  });

  it('stays quiet with disclosure: false', () => {
    render(
      <Root config={withDisclosure(false)}>
        <Input />
      </Root>,
    );
    expect(notes()).toHaveLength(0);
  });
});
