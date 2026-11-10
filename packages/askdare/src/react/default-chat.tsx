import type { ReactElement } from 'react';
import { useStore } from './context';
import { DefaultPanel, type DefaultPanelProps } from './skin';
import { Theme, type ThemeProps } from './theme';

export interface DefaultChatProps extends DefaultPanelProps {
  /** On the element that holds the chat. Give it a height: the chat fills it. */
  readonly className?: string | undefined;
  readonly colorScheme?: ThemeProps['colorScheme'];
}

/**
 * The widget's look inside your page: `<Root config={config}><DefaultChat className="…" /></Root>`.
 * It loads its stylesheets from the chat route, so there is nothing to import or configure.
 */
export function DefaultChat({ className, colorScheme, ...panel }: DefaultChatProps): ReactElement {
  const { styles } = useStore().config;
  return (
    <Theme className={className} colorScheme={colorScheme}>
      {styles && <link rel="stylesheet" href={styles.skin} precedence="askdare" />}
      <DefaultPanel {...panel} />
    </Theme>
  );
}
