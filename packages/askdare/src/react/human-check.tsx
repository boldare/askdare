import { type ComponentProps, type ReactElement, useEffect, useRef } from 'react';
import { TURNSTILE_SCRIPT } from '../security/human-verifier';
import { useChat, useChatConfig, useStore } from './context';

export type HumanCheckProps = Omit<ComponentProps<'div'>, 'children'>;

/** The part of Cloudflare's Turnstile API the chat uses (explicit rendering). */
interface TurnstileApi {
  render(container: HTMLElement, options: Readonly<Record<string, unknown>>): string | undefined;
  remove(widgetId: string): void;
}

let loading: Promise<TurnstileApi> | undefined;

/** Turnstile's API, its script loaded once, when the first check is needed. */
const turnstile = (): Promise<TurnstileApi> => {
  const ready = (): TurnstileApi | undefined => (window as { turnstile?: TurnstileApi }).turnstile;
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const api = ready();
    if (api) return resolve(api);
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.onload = () => {
      const loaded = ready();
      if (loaded) resolve(loaded);
      else reject();
    };
    script.onerror = () => {
      loading = undefined; // a later check tries again
      script.remove();
      reject();
    };
    document.head.append(script);
  });
  return loading;
};

/**
 * The bot's human check (`security.humanVerifier`), shown while the chat waits for it before it
 * connects; nothing otherwise. The default look includes it; a headless chat whose bot has a check
 * must render it, or it can't connect.
 */
export function HumanCheck(props: HumanCheckProps): ReactElement | null {
  const store = useStore();
  const { state, t } = useChat();
  const { humanCheck: challenge, widget } = useChatConfig();
  const container = useRef<HTMLDivElement>(null);
  const active = state.humanCheck && challenge !== undefined;

  useEffect(() => store.attachHumanCheck(), [store]);

  useEffect(() => {
    const element = container.current;
    if (!active || !challenge || !element) return;
    let live = true;
    let remove = (): void => {};
    turnstile().then(
      (api) => {
        if (!live) return;
        // A token is used once, right away; the next session renders a new widget.
        const id = api.render(element, {
          sitekey: challenge.siteKey,
          callback: (token: string) => store.answerHumanCheck(token),
          'error-callback': () => store.answerHumanCheck(null),
          size: 'flexible',
          language: widget.locale,
        });
        if (id !== undefined) remove = () => api.remove(id);
      },
      () => live && store.answerHumanCheck(null),
    );
    return () => {
      live = false;
      remove();
    };
  }, [active, challenge, widget.locale, store]);

  if (!active) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a third-party widget's frame, not a form's fieldset
    <div
      data-ask-part="human-check"
      role="group"
      aria-label={t('humanCheck.label')}
      {...props}
      ref={container}
    />
  );
}
