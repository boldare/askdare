import { type ComponentProps, type DragEvent, type ReactElement, useState } from 'react';
import { useChat } from './context';

export interface PanelProps extends ComponentProps<'section'> {
  /**
   * `main` when the chat is the page, as in its iframe; otherwise a region named after the bot,
   * so it sits among the page's own landmarks. Default `region`.
   */
  readonly landmark?: 'main' | 'region';
}

const hasFiles = (event: DragEvent): boolean => event.dataTransfer.types.includes('Files');

/**
 * The chat's frame, with `data-busy` while the assistant answers or a dictation runs. Files dropped
 * on it are attached (`data-dragging` while they are over it).
 */
export function Panel({
  landmark = 'region',
  onDragOver,
  onDragLeave,
  onDrop,
  ...props
}: PanelProps): ReactElement {
  const { state, actions, bot } = useChat();
  const [dragging, setDragging] = useState(false);
  const attributes = {
    'data-ask-part': 'panel',
    'data-dragging': dragging || undefined,
    'data-busy': state.busy || state.dictation !== 'idle' || undefined,
    // The attach button covers keyboard users.
    onDragOver: (event: DragEvent<HTMLElement>) => {
      onDragOver?.(event);
      if (!bot.attachments || !hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      onDragLeave?.(event);
      const to = event.relatedTarget;
      if (!(to instanceof Node && event.currentTarget.contains(to))) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      onDrop?.(event);
      if (!bot.attachments || !hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      actions.addFiles(Array.from(event.dataTransfer.files));
    },
  };
  return landmark === 'main' ? (
    <main {...attributes} {...props} />
  ) : (
    <section aria-label={bot.title} {...attributes} {...props} />
  );
}
