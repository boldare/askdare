import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { acceptTypes } from '../chat/prepare-file';
import { canSend } from '../chat/state';
import { useChat, useStore } from './context';
import { FileList } from './messages';
import { useMergedRef } from './refs';

/** Grows the message field with its content, up to the height set in CSS. */
function fitToContent(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export type ComposerProps = ComponentProps<'form'>;

/** The form around the message field; submitting it sends the draft. */
export function Composer({ onSubmit, ...props }: ComposerProps): ReactElement {
  const { actions } = useChat();
  return (
    <form
      data-ask-part="composer"
      onSubmit={(event) => {
        onSubmit?.(event);
        event.preventDefault();
        void actions.send();
      }}
      {...props}
    />
  );
}

export type InputProps = Omit<ComponentProps<'textarea'>, 'value'>;

/**
 * The message field. Enter sends, Shift+Enter starts a new line, pasted files are attached, and
 * it grows with its text. It takes focus when the chat moves it here.
 */
export function Input({ ref, onKeyDown, onPaste, onChange, ...props }: InputProps): ReactElement {
  const own = useRef<HTMLTextAreaElement>(null);
  const { state, actions, bot } = useChat();
  const store = useStore();
  const { draft } = state;

  // Fit the field to its text whenever it changes, typed or not (a transcript, a restored draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field shows draft, which sets its height
  useLayoutEffect(() => {
    if (own.current) fitToContent(own.current);
  }, [draft]);

  useEffect(
    () => store.onFocus('input', () => requestAnimationFrame(() => own.current?.focus())),
    [store],
  );

  return (
    <textarea
      data-ask-part="input"
      rows={1}
      placeholder={bot.placeholder}
      aria-label={bot.placeholder}
      {...props}
      ref={useMergedRef(own, ref)}
      value={draft}
      onChange={(event) => {
        onChange?.(event);
        actions.setDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void actions.send();
        }
      }}
      onPaste={(event) => {
        onPaste?.(event);
        const files = Array.from(event.clipboardData.files);
        if (!bot.attachments || files.length === 0) return;
        event.preventDefault();
        actions.addFiles(files);
      }}
    />
  );
}

export type SendProps = ComponentProps<'button'>;

/** Sends the draft; disabled until there is something to send. */
export function Send(props: SendProps): ReactElement {
  const { state, t } = useChat();
  return (
    <button
      type="submit"
      data-ask-part="send"
      aria-label={t('composer.send')}
      title={t('composer.send')}
      disabled={!canSend(state)}
      {...props}
    />
  );
}

export type AttachButtonProps = ComponentProps<'button'>;

/**
 * Opens the file picker, next to its hidden file input. Renders nothing when the bot takes no
 * attachments.
 */
export function AttachButton({ onClick, ...props }: AttachButtonProps): ReactElement | null {
  const file = useRef<HTMLInputElement>(null);
  const { state, actions, bot, t } = useChat();
  const allowed = bot.attachments;
  if (!allowed) return null;
  return (
    <>
      <input
        ref={file}
        type="file"
        hidden
        multiple
        accept={acceptTypes(allowed)}
        onChange={(event) => {
          actions.addFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <button
        type="button"
        data-ask-part="attach"
        aria-label={t('composer.attach')}
        title={t('composer.attach')}
        disabled={state.busy || state.files.length >= allowed.maxPerMessage}
        onClick={(event) => {
          onClick?.(event);
          file.current?.click();
        }}
        {...props}
      />
    </>
  );
}

export type FilesProps = ComponentProps<'ul'>;

/** The files picked for the next message, each with a remove button. */
export function Files(props: FilesProps): ReactElement | null {
  const { state, actions } = useChat();
  if (state.files.length === 0) return null;
  return (
    <FileList
      files={state.files}
      list="attachments"
      onRemove={(file) => actions.removeFile(file.key)}
      {...props}
    />
  );
}

export type DictateButtonProps = ComponentProps<'button'>;

/** Starts a dictation. Renders nothing without voice input or a usable microphone. */
export function DictateButton({ onClick, ...props }: DictateButtonProps): ReactElement | null {
  const { state, actions, t } = useChat();
  if (!state.canDictate) return null;
  return (
    <button
      type="button"
      data-ask-part="voice"
      aria-label={t('composer.dictate')}
      title={t('composer.dictate')}
      onClick={(event) => {
        onClick?.(event);
        void actions.startDictation();
      }}
      {...props}
    />
  );
}

export interface RecorderProps extends ComponentProps<'div'> {
  /** Inside the cancel button, which is labelled for screen readers. Default `×`. */
  readonly cancelIcon?: ReactNode;
}

/**
 * The dictation in place of the message field: a level meter, the time, cancel and done. Renders
 * nothing while no dictation runs.
 */
export function Recorder({ cancelIcon = '×', ...props }: RecorderProps): ReactElement | null {
  const level = useRef<HTMLSpanElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const store = useStore();
  const { state, actions, bot, t } = useChat();
  const { dictation } = state;

  useEffect(
    () => store.onFocus('dictation', () => requestAnimationFrame(() => done.current?.focus())),
    [store],
  );

  // Only the level meter follows animation frames, and it is written to the DOM, not rendered.
  useEffect(() => {
    if (dictation !== 'recording') return;
    let frame = requestAnimationFrame(function tick() {
      const value = store.level();
      if (value !== undefined) level.current?.style.setProperty('--ask-level', value.toFixed(3));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [dictation, store]);

  if (dictation === 'idle') return null;
  return (
    <div data-ask-part="recorder" data-state={dictation} {...props}>
      <span data-ask-part="recorder-level" ref={level} aria-hidden="true" />
      <span data-ask-part="recorder-label" role="status">
        {dictation === 'recording' ? t('dictation.listening') : t('dictation.transcribing')}
      </span>
      {dictation === 'recording' && (
        <>
          <span data-ask-part="recorder-time">
            {clock(state.elapsed)} / {clock(bot.maxDictationSeconds ?? 0)}
          </span>
          <button
            type="button"
            data-ask-part="recorder-cancel"
            aria-label={t('dictation.cancel')}
            title={t('dictation.cancel')}
            onClick={() => actions.cancelDictation()}
          >
            {cancelIcon}
          </button>
          <button
            type="button"
            data-ask-part="recorder-done"
            ref={done}
            onClick={() => void actions.finishDictation()}
          >
            {t('dictation.done')}
          </button>
        </>
      )}
    </div>
  );
}
