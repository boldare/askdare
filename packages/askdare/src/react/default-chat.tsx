import { type ReactElement, useContext } from 'react';
import { FrameContext, useStore } from './context';
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
  // In the widget's iframe the chat is the document, as askdare's own page is (ADR-0018).
  const frame = useContext(FrameContext);
  return (
    // data-ask-skin: the skin's rules reach only inside this element, never a headless chat.
    <Theme className={className} colorScheme={colorScheme} data-ask-skin="">
      {styles && <link rel="stylesheet" href={styles.skin} precedence="askdare" />}
      {frame ? (
        <DefaultPanel
          headingLevel={1}
          {...panel}
          onClose={panel.onClose ?? frame.close}
          ownsDocument
        />
      ) : (
        <DefaultPanel {...panel} />
      )}
    </Theme>
  );
}
