import type { ReactNode } from 'react';
import type { EmbedWidget } from '../server/embed-page';
import { ArrowIcon, CheckIcon, SparkIcon } from './icons';

const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || 'AI';

/** `**words**` in a greeting are shown in bold, as in Aura's two-weight headline; nothing else is markup. */
function emphasized(text: string): ReactNode[] {
  return text.split('**').map((part, index) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed string never move
    index % 2 === 1 ? <strong key={index}>{part}</strong> : part,
  );
}

/** The assistant's face: the configured picture, else the preset's orb, icon or initials. */
export function Avatar({
  widget,
  size,
}: {
  readonly widget: EmbedWidget;
  readonly size: 'small' | 'large';
}) {
  const variant = widget.avatar ? 'image' : widget.variants.avatar;
  if (variant === 'none') return null;
  return (
    <span data-ask-part="avatar" data-kind={variant} data-size={size} aria-hidden="true">
      {variant === 'image' && <img src={widget.avatar} alt="" />}
      {variant === 'orb' && <span data-ask-part="orb" />}
      {variant === 'icon' && <SparkIcon size={size === 'large' ? 28 : 16} />}
      {variant === 'initials' && initials(widget.title)}
    </span>
  );
}

function Starters({
  widget,
  disabled,
  onPick,
}: {
  readonly widget: EmbedWidget;
  readonly disabled: boolean;
  readonly onPick: (text: string) => void;
}) {
  if (widget.starters.length === 0) return null;
  const checklist = widget.variants.welcome === 'intro';
  return (
    <ul data-ask-part="starters" aria-label={widget.texts['welcome.suggestions']}>
      {widget.starters.map((starter) => (
        <li key={starter}>
          <button
            type="button"
            data-ask-part="starter"
            disabled={disabled}
            onClick={() => onPick(starter)}
          >
            {checklist ? <CheckIcon /> : <SparkIcon />}
            <span>{starter}</span>
            {widget.variants.welcome === 'persona' && <ArrowIcon />}
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
export function Welcome({
  widget,
  disabled,
  onPick,
}: {
  readonly widget: EmbedWidget;
  readonly disabled: boolean;
  readonly onPick: (text: string) => void;
}) {
  const layout = widget.variants.welcome;
  const starters = <Starters widget={widget} disabled={disabled} onPick={onPick} />;
  if (layout === 'intro') {
    return (
      <section
        data-ask-part="welcome"
        data-layout="intro"
        aria-label={widget.texts['welcome.label']}
      >
        <div data-ask-part="intro">
          <Avatar widget={widget} size="small" />
          <div data-ask-part="intro-card">
            <p data-ask-part="greeting">{emphasized(widget.greeting)}</p>
            {starters}
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
        aria-label={widget.texts['welcome.label']}
      >
        <div data-ask-part="persona">
          <Avatar widget={widget} size="large" />
          <div>
            <h2 data-ask-part="persona-name">{widget.title}</h2>
            <span data-ask-part="presence">{widget.texts['welcome.online']}</span>
          </div>
        </div>
        <p data-ask-part="greeting">{emphasized(widget.greeting)}</p>
        {starters}
      </section>
    );
  }
  return (
    <section data-ask-part="welcome" data-layout="hero" aria-label={widget.texts['welcome.label']}>
      <Avatar widget={widget} size="large" />
      <h2 data-ask-part="greeting">{emphasized(widget.greeting)}</h2>
      {starters}
    </section>
  );
}
