'use client';

// The entry of an ejected copy (`npx @boldare/askdare add ui`): the same DefaultChat as in
// @boldare/askdare/react, built from the files in this folder and their own stylesheet. Inside
// the package nothing imports it: there, DefaultChat loads the skin from the chat route.
import { Theme, type ThemeProps } from '@boldare/askdare/react';
import type { ReactElement } from 'react';
import './askdare.css';
import { DefaultPanel, type DefaultPanelProps } from './panel';

export interface DefaultChatProps extends DefaultPanelProps {
  /** On the element that holds the chat. Give it a height: the chat fills it. */
  readonly className?: string | undefined;
  readonly colorScheme?: ThemeProps['colorScheme'];
}

/** The chat with this folder's look: `<Root config={config}><DefaultChat className="…" /></Root>`. */
export function DefaultChat({ className, colorScheme, ...panel }: DefaultChatProps): ReactElement {
  return (
    // data-ask-skin: the skin's rules reach only inside this element, never a headless chat.
    <Theme className={className} colorScheme={colorScheme} data-ask-skin="">
      <DefaultPanel {...panel} />
    </Theme>
  );
}
