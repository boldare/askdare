import type { ComponentProps, ReactElement } from 'react';
import { useStore } from './context';

/** React 19 hoists these into <head> and waits for them, in this order, before showing the chat. */
const PRECEDENCE = 'askdare';

export interface ThemeProps extends ComponentProps<'div'> {
  /** Overrides the bot's color scheme, for example to follow your site's dark mode switch. */
  readonly colorScheme?: 'auto' | 'light' | 'dark' | undefined;
}

/**
 * The theme root of a chat inside a page: sets the bot's tokens (`--ask-*`) and variant attributes
 * for everything inside it, and loads the bot's theme and fonts from the chat route. Size it with
 * `className` or `style`; the chat fills it.
 */
export function Theme({ colorScheme, children, ...props }: ThemeProps): ReactElement {
  const { widget, styles } = useStore().config;
  const variants = Object.fromEntries(
    Object.entries(widget.variants).map(([name, value]) => [`data-ask-${name}`, value]),
  );
  return (
    <div
      data-askdare-root=""
      data-ask-preset={widget.preset}
      data-ask-scheme={colorScheme ?? widget.colorScheme}
      {...variants}
      {...props}
    >
      {styles && (
        <>
          <link rel="stylesheet" href={styles.fonts} precedence={PRECEDENCE} />
          <link rel="stylesheet" href={styles.theme} precedence={PRECEDENCE} />
        </>
      )}
      {children}
    </div>
  );
}
