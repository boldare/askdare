import { createRoot } from 'react-dom/client';
import { formatText } from '../i18n/format';
import type { EmbedConfig } from '../server/embed-page';
import { App } from './app';
import { ChatClient } from './chat-client';
import { FIXTURES } from './gallery';
import { connectToHost } from './host-bridge';
import { browserStorage } from './storage';
import './styles.css';

function readConfig(): EmbedConfig {
  const element = document.getElementById('chatdock-config');
  const config = JSON.parse(element?.textContent ?? 'null') as EmbedConfig | null;
  if (!config?.botId || !config.basePath)
    throw new Error('[chatdock] Missing embed configuration.');
  return config;
}

const config = readConfig();
const root = document.getElementById('chatdock-root');
if (root) {
  const client = new ChatClient({
    basePath: config.basePath,
    botId: config.botId,
    locale: config.widget.locale,
    storage: browserStorage(),
    translate: (key, params) => {
      const template = config.widget.texts[key];
      return template === undefined ? undefined : formatText(template, params);
    },
  });
  createRoot(root).render(
    <App
      config={config}
      client={client}
      bridge={connectToHost(config.allowedOrigins)}
      fixture={config.gallery ? FIXTURES[config.gallery] : undefined}
      inline={new URLSearchParams(window.location.search).get('mode') === 'inline'}
    />,
  );
}
