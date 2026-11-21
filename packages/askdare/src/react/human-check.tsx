import { type ComponentProps, type ReactElement, useEffect, useRef } from 'react';
import { TURNSTILE_SCRIPT, turnstileAction } from '../security/human-verifier';
import { useChat, useChatConfig, useStore } from './context';

export type HumanCheckProps = Omit<ComponentProps<'div'>, 'children'>;

/** The part of Cloudflare's Turnstile API the chat uses (explicit rendering). */
interface TurnstileApi {
  render(container: HTMLElement, options: Readonly<Record<string, unknown>>): string | undefined;
  remove(widgetId: string): void;
}

let loading: Promise<TurnstileApi> | undefined;

/** Errors (each followed by Turnstile's own retry) before the check counts as failed. */
const MAX_ERRORS = 3;

/** Turnstile's API, its script loaded once, when the first check is needed. */
const turnstile = (): Promise<TurnstileApi> => {
  const ready = (): TurnstileApi | undefined => (window as { turnstile?: TurnstileApi }).turnstile;
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const api = ready();
    if (api) return resolve(api);
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    const fail = (): void => {
      loading = undefined; // a later check tries again
      script.remove();
      reject();
    };
    script.onload = () => {
      const loaded = ready();
      if (loaded) resolve(loaded);
      else fail();
    };
    script.onerror = fail;
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
  const { humanCheck: challenge, widget, botId } = useChatConfig();
  const container = useRef<HTMLDivElement>(null);
  const active = state.humanCheck && challenge !== undefined;

  useEffect(() => store.attachHumanCheck(), [store]);

  useEffect(() => {
    const element = container.current;
    if (!active || !challenge || !element) return;
    let live = true;
    let errors = 0;
    let remove = (): void => {};
    turnstile().then(
      (api) => {
        if (!live) return;
        // A token is used once, right away; the next session renders a new widget.
        const id = api.render(element, {
          sitekey: challenge.siteKey,
          action: turnstileAction(botId),
          callback: (token: string) => store.answerHumanCheck(token),
          // Turnstile retries on its own (retry: auto, every 8 s); only a third error fails the
          // check. Returning false lets it log and retry; true marks the error handled.
          'error-callback': () => {
            if (++errors < MAX_ERRORS) return false;
            store.answerHumanCheck(null);
            return true;
          },
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
  }, [active, challenge, widget.locale, botId, store]);

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
