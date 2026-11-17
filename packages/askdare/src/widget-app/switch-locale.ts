import type { ChatStore } from '../chat/store';
import type { HostBridge } from './host-bridge';

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
