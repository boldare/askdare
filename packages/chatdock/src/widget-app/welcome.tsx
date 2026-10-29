import type { EmbedWidget } from '../server/embed-page';
import { ArrowIcon, CheckIcon, SparkIcon } from './icons';

const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || 'AI';

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
    <span data-cd-part="avatar" data-kind={variant} data-size={size} aria-hidden="true">
      {variant === 'image' && <img src={widget.avatar} alt="" />}
      {variant === 'orb' && <span data-cd-part="orb" />}
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
    <ul data-cd-part="starters" aria-label="Suggested questions">
      {widget.starters.map((starter) => (
        <li key={starter}>
          <button
            type="button"
            data-cd-part="starter"
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
      <section data-cd-part="welcome" data-layout="intro" aria-label="Welcome">
        <div data-cd-part="intro">
          <Avatar widget={widget} size="small" />
          <div data-cd-part="intro-card">
            <p data-cd-part="greeting">{widget.greeting}</p>
            {starters}
          </div>
        </div>
      </section>
    );
  }
  if (layout === 'persona') {
    return (
      <section data-cd-part="welcome" data-layout="persona" aria-label="Welcome">
        <div data-cd-part="persona">
          <Avatar widget={widget} size="large" />
          <div>
            <h2 data-cd-part="persona-name">{widget.title}</h2>
            <span data-cd-part="presence">Online</span>
          </div>
        </div>
        <p data-cd-part="greeting">{widget.greeting}</p>
        {starters}
      </section>
    );
  }
  return (
    <section data-cd-part="welcome" data-layout="hero" aria-label="Welcome">
      <Avatar widget={widget} size="large" />
      <h2 data-cd-part="greeting">{widget.greeting}</h2>
      {starters}
    </section>
  );
}
