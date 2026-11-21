import type { ComponentProps, ReactElement } from 'react';
import type { ChatStore } from '../chat/store';
import { useChatConfig, useStore, useTexts } from './context';

// Replaced by the app's bundler. Declared here because the React entry builds without Node's types.
declare const process: { readonly env: { readonly NODE_ENV?: string | undefined } };

/** Chats that rendered a `Disclosure`, or were already told they don't. Development only. */
const disclosed = /* @__PURE__ */ new WeakSet<ChatStore>();

export type DisclosureProps = ComponentProps<'p'>;

/**
 * The AI notice (EU AI Act, art. 50): `disclosure.text`, with a link to the bot's
 * `widget.disclosure.privacyUrl` when it has one. Children replace the text with your own notice.
 * Renders nothing when the bot sets `disclosure: false`.
 */
export function Disclosure({ children, ...props }: DisclosureProps): ReactElement | null {
  const store = useStore();
  const { disclosure } = useChatConfig().widget;
  const t = useTexts();
  // Idempotent, so marking during render is safe; gone from production builds.
  if (process.env.NODE_ENV !== 'production') disclosed.add(store);
  if (disclosure === false) return null;
  return (
    <p data-ask-part="disclosure" {...props}>
      {children ?? (
        <>
          {t('disclosure.text')}
          {disclosure.privacyUrl && (
            <>
              {' '}
              <a href={disclosure.privacyUrl} target="_blank" rel="noopener noreferrer">
                {t('disclosure.privacy')}
              </a>
            </>
          )}
        </>
      )}
    </p>
  );
}

/**
 * In development, after the chat's first render: notes once when it rendered no `Disclosure` while
 * the bot keeps the notice on (ADR-0019). `disclosure: false` silences it.
 */
export function noteMissingDisclosure(store: ChatStore): void {
  if (store.config.widget.disclosure === false || disclosed.has(store)) return;
  disclosed.add(store);
  console.warn(
    "[askdare] This chat renders no <Disclosure />, so visitors aren't told they are talking to an AI (EU AI Act, art. 50). Add <Disclosure /> from @boldare/askdare/react (children replace its text), or set widget.disclosure: false in defineBot if your page already says so.",
  );
}
