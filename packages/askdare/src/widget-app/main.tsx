import { createRoot } from 'react-dom/client';
import { createFixtureStore } from '../chat/fixture-store';
import { createChatStore } from '../chat/store';
import type { EmbedConfig } from '../server/embed-page';
import { App } from './app';
import { bindBridge } from './bind-bridge';
import { FIXTURES } from './gallery';
import { connectToHost } from './host-bridge';
import '../react/skin/askdare.css';
import './frame.css';

function readConfig(): EmbedConfig {
  const element = document.getElementById('askdare-config');
  const config = JSON.parse(element?.textContent ?? 'null') as EmbedConfig | null;
  if (!config?.botId || !config.basePath) throw new Error('[askdare] Missing embed configuration.');
  return config;
}

const config = readConfig();
const root = document.getElementById('askdare-root');
if (root) {
  const fixture = config.gallery ? FIXTURES[config.gallery] : undefined;
  const store = fixture ? createFixtureStore(config, fixture) : createChatStore(config);
  const bridge = connectToHost(config.allowedOrigins);
  // Started before the first render, so a stored conversation shows as loading from the start.
  const unbind = bindBridge(store, bridge);
  /** The language the page asked for last; an older switch that fails afterwards is moot. */
  let wanted: string | undefined;
  const withLang = (locale: string): URL => {
    const url = new URL(location.href);
    url.searchParams.set('lang', locale);
    return url;
  };
  // The page switched the chat's language (ADR-0014). In place (step 2): new texts, and the
  // conversation, the draft and an answer under way stay. A loader from before step 2, or texts
  // that can't be loaded: the answer under way ends here, so the page hears it as stopped before
  // the reload cuts it off, and the chat reloads in that language; it restores the conversation,
  // and the loader connects again.
  const reload = (locale: string): void => {
    unbind();
    location.replace(withLang(locale));
  };
  bridge.onLocale((locale, inPlace) => {
    wanted = locale;
    if (!inPlace) return reload(locale);
    void store.setLocale(locale).then((switched) => {
      if (!switched) {
        if (wanted === locale) reload(locale);
        return;
      }
      document.documentElement.lang = store.language ?? locale;
      document.title = store.config.widget.title;
      // A reload, by the visitor or after an error, keeps the new language.
      history.replaceState(history.state, '', withLang(locale));
    });
  });
  createRoot(root).render(
    <App
      store={store}
      bridge={bridge}
      inline={new URLSearchParams(window.location.search).get('mode') === 'inline'}
    />,
  );
}
