// @vitest-environment happy-dom
// The skin may import only its own files (ADR-0011), so its tests live beside it, not in it.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, testConfig } from '../chat/testing/fake-server';
import { Root } from './headless';
import { StartOverQuestion } from './skin/confirm';
import { DefaultPanel } from './skin/panel';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', fakeServer().fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function question(props: { busy?: boolean; modal?: boolean } = {}) {
  const onCancel = vi.fn();
  const onAccept = vi.fn();
  render(
    <Root config={testConfig()}>
      <StartOverQuestion
        modal={props.modal ?? true}
        busy={props.busy ?? false}
        onCancel={onCancel}
        onAccept={onAccept}
      />
    </Root>,
  );
  return {
    onCancel,
    onAccept,
    dialog: screen.getByRole('alertdialog', { name: 'Start a new conversation' }),
    cancel: screen.getByRole('button', { name: 'Cancel' }),
    accept: screen.getByRole('button', { name: 'Start new' }),
  };
}

describe('StartOverQuestion', () => {
  it('is an alertdialog described by its question', () => {
    const { dialog } = question();
    const text = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(text?.textContent).toBe('Start a new conversation? The current one will be deleted.');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.hasAttribute('aria-busy')).toBe(false);
  });

  it('starts focus on Cancel, the safe answer', async () => {
    const { cancel } = question();
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  it('keeps Tab inside: forward from the last button wraps to the first', () => {
    const { dialog, cancel, accept } = question();
    accept.focus();
    const event = fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(event).toBe(false); // default prevented
    expect(document.activeElement).toBe(cancel);
  });

  it('keeps Shift+Tab inside: back from the first button wraps to the last', () => {
    const { dialog, cancel, accept } = question();
    cancel.focus();
    const event = fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(event).toBe(false);
    expect(document.activeElement).toBe(accept);
  });

  it('lets Tab move between the buttons on its own', () => {
    const { dialog, cancel, accept } = question();
    cancel.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(true);
    accept.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(dialog, { key: 'Enter' })).toBe(true);
  });

  it('answers with either button', () => {
    const { cancel, accept, onCancel, onAccept } = question();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(accept);
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('waits while busy, keeping the buttons focusable', () => {
    const { dialog, cancel, accept, onCancel, onAccept } = question({ busy: true });
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    for (const button of [cancel, accept]) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
      fireEvent.click(button);
    }
    expect(onCancel).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('is not modal inside a page', () => {
    const { dialog } = question({ modal: false });
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
  });
});

describe('Escape on the start-over question', () => {
  async function ask(onClose: () => void): Promise<HTMLElement> {
    render(
      <Root config={testConfig()}>
        <DefaultPanel onClose={onClose} />
      </Root>,
    );
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Hello' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('You said: Hello');
    fireEvent.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    return screen.getByRole('alertdialog');
  }

  it('cancels the question, not the chat, and returns focus to the restart button', async () => {
    const onClose = vi.fn();
    const dialog = await ask(onClose);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(dialog.isConnected).toBe(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('You said: Hello')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Start a new conversation' }),
      ),
    );

    // With the question gone, Escape closes the chat again.
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves an Escape that a handler already used alone', async () => {
    const onClose = vi.fn();
    await ask(onClose);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});
