import { createRoot } from 'react-dom/client';
import { bindBridge } from '../chat/bind-bridge';
import { createFixtureStore } from '../chat/fixture-store';
import { connectToHost } from '../chat/host-bridge';
import { createChatStore } from '../chat/store';
import { switchLocale } from '../chat/switch-locale';
import type { EmbedConfig } from '../server/embed-page';
import { App } from './app';
import { FIXTURES } from './gallery';
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
  const withLang = (locale: string): URL => {
    const url = new URL(location.href);
    url.searchParams.set('lang', locale);
    return url;
  };
  switchLocale(store, bridge, {
    // The answer under way ends here, so the page hears it as stopped before the reload cuts it
    // off; the chat restores the conversation, and the loader connects again.
    reload(locale) {
      unbind();
      location.replace(withLang(locale));
    },
    switched(locale, language) {
      document.documentElement.lang = language;
      document.title = store.config.widget.title;
      // A reload, by the visitor or after an error, keeps the new language.
      history.replaceState(history.state, '', withLang(locale));
    },
  });
  createRoot(root).render(
    <App
      store={store}
      bridge={bridge}
      inline={new URLSearchParams(window.location.search).get('mode') === 'inline'}
    />,
  );
}
