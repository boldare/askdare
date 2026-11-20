import type { HostBridge } from './host-bridge';
import type { ChatStore } from './store';

export interface LocaleSwitch {
  /** Reloads the chat in `locale`: the step 1 switch, and the fallback of step 2. */
  reload(locale: string): void;
  /** The chat now shows `locale`'s texts, written in `language`. */
  switched(locale: string, language: string): void;
}

/**
 * Switches the chat's language when the page asks (ADR-0014). In place when the loader says so
 * (`inPlace`, step 2): new texts, and the conversation, the draft and an answer under way stay.
 * A loader from before step 2, or texts that can't be loaded for the language the page wants
 * last, reload the chat instead; a switch overtaken by a later one does nothing.
 */
export function switchLocale(
  store: Pick<ChatStore, 'setLocale' | 'language'>,
  bridge: Pick<HostBridge, 'onLocale'>,
  effects: LocaleSwitch,
): () => void {
  let wanted: string | undefined;
  return bridge.onLocale((locale, inPlace) => {
    wanted = locale;
    if (!inPlace) {
      effects.reload(locale);
      return;
    }
    void store.setLocale(locale).then((switched) => {
      if (switched) effects.switched(locale, store.language ?? locale);
      else if (wanted === locale) effects.reload(locale);
    });
  });
}

/** This page's URL in `locale`, so a reload, by the visitor or after an error, keeps it. */
function withLang(locale: string): URL {
  const url = new URL(location.href);
  url.searchParams.set('lang', locale);
  return url;
}

/**
 * Follows the page's language in the chat's iframe, askdare's own page or a site's (ADR-0014,
 * ADR-0018): in place when it can, else by reloading with the new `lang`. `unbind` disconnects the
 * chat first, so the page hears an answer under way as stopped before the reload cuts it off.
 */
export function followLocale(
  store: Pick<ChatStore, 'setLocale' | 'language' | 'config'>,
  bridge: Pick<HostBridge, 'onLocale'>,
  unbind: () => void,
): () => void {
  return switchLocale(store, bridge, {
    reload(locale) {
      unbind();
      location.replace(withLang(locale));
    },
    switched(locale, language) {
      document.documentElement.lang = language;
      document.title = store.config.widget.title;
      history.replaceState(history.state, '', withLang(locale));
    },
  });
}
