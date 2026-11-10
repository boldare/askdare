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
  bindBridge(store, bridge);
  createRoot(root).render(
    <App
      store={store}
      bridge={bridge}
      inline={new URLSearchParams(window.location.search).get('mode') === 'inline'}
    />,
  );
}
