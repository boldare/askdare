import { useChat } from '@boldare/askdare/react';
import type { ReactElement, ReactNode } from 'react';
import { Avatar } from './avatar';
import { heading, useSkin } from './context';
import { ArrowIcon, CheckIcon, SparkIcon } from './icons';

/** `**words**` in a greeting are shown in bold, as in Aura's two-weight headline; nothing else is markup. */
function emphasized(text: string): ReactNode[] {
  return text.split('**').map((part, index) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed string never move
    index % 2 === 1 ? <strong key={index}>{part}</strong> : part,
  );
}

function Starters(): ReactElement | null {
  const { state, actions, bot } = useChat();
  if (bot.starters.length === 0) return null;
  const checklist = bot.variants.welcome === 'intro';
  const disabled = state.busy || state.phase !== 'ready';
  return (
    <ul data-ask-part="starters" aria-label={bot.texts['welcome.suggestions']}>
      {bot.starters.map((starter) => (
        <li key={starter}>
          <button
            type="button"
            data-ask-part="starter"
            disabled={disabled}
            onClick={() => void actions.send(starter)}
          >
            {checklist ? <CheckIcon /> : <SparkIcon />}
            <span>{starter}</span>
            {bot.variants.welcome === 'persona' && <ArrowIcon />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a visitor sees before the first message. The preset picks the layout: a centered hero,
 * a persona card, or an opening message with a checklist of what the assistant can do.
 */
export function DefaultWelcome(): ReactElement {
  const { bot } = useChat();
  const Heading = heading(useSkin().headingLevel + 1);
  const layout = bot.variants.welcome;
  if (layout === 'intro') {
    return (
      <section data-ask-part="welcome" data-layout="intro" aria-label={bot.texts['welcome.label']}>
        <div data-ask-part="intro">
          <Avatar size="small" />
          <div data-ask-part="intro-card">
            <p data-ask-part="greeting">{emphasized(bot.greeting)}</p>
            <Starters />
          </div>
        </div>
      </section>
    );
  }
  if (layout === 'persona') {
    return (
      <section
        data-ask-part="welcome"
        data-layout="persona"
        aria-label={bot.texts['welcome.label']}
      >
        <div data-ask-part="persona">
          <Avatar size="large" />
          <div>
            <Heading data-ask-part="persona-name">{bot.title}</Heading>
            <span data-ask-part="presence">{bot.texts['welcome.online']}</span>
          </div>
        </div>
        <p data-ask-part="greeting">{emphasized(bot.greeting)}</p>
        <Starters />
      </section>
    );
  }
  return (
    <section data-ask-part="welcome" data-layout="hero" aria-label={bot.texts['welcome.label']}>
      <Avatar size="large" />
      <Heading data-ask-part="greeting">{emphasized(bot.greeting)}</Heading>
      <Starters />
    </section>
  );
}
