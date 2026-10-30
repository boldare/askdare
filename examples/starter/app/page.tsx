import Image from 'next/image';
import type { ReactNode } from 'react';
import { DEMO_BOTS } from '@/chatdock.config';
import { HeroShape } from './_shape/hero-shape';
import { ChatScript } from './chat-script';
import { KeepCurrentInView } from './keep-current';
import { NavMenu } from './nav-menu';
import { ShapeIcon } from './shape-icon';

type Search = Promise<Record<string, string | string[] | undefined>>;

const THEMES = [
  { id: 'aura', name: 'Aura', note: 'Glossy and voice-first, around an iridescent bubble.' },
  { id: 'sage', name: 'Sage', note: 'A calm companion with a face and a name.' },
  { id: 'halo', name: 'Halo', note: 'Clean and bright: a frosted orb in rings of light.' },
  { id: 'care', name: 'Care', note: 'Trust first: hyperlegible type, AAA contrast.' },
  {
    id: 'bldr',
    name: 'BLDR',
    note: "A custom theme in Boldare's style: one of the presets, adjusted with defineTheme and a few lines of CSS.",
  },
] as const;
/** Built-in presets; BLDR is the custom example. */
const PRESETS = THEMES.filter((item) => item.id !== 'bldr');
const CUSTOM = THEMES.find((item) => item.id === 'bldr');
type Theme = (typeof THEMES)[number]['id'];

const MODES = [
  { id: 'bubble', name: 'Bubble' },
  { id: 'inline', name: 'In the page' },
] as const;
type Mode = (typeof MODES)[number]['id'];

/**
 * Design variants under review, switched with the bar at the top of the page. Once one is
 * chosen per area, the others and the bar go.
 */
const AREAS = [
  { id: 'filters', name: 'Hero filters', variants: ['Control card', 'Swatches', 'Dock on stage'] },
  { id: 'features', name: 'Features', variants: ['Grid', 'Bento', 'List'] },
  { id: 'how', name: 'How it works', variants: ['Columns', 'Timeline', 'Terminal'] },
  { id: 'themes', name: 'Themes', variants: ['Row and banner', 'Bento', 'Rows'] },
] as const;
type Area = (typeof AREAS)[number]['id'];
const VARIANTS = [{ id: '1' }, { id: '2' }, { id: '3' }] as const;
type Variant = (typeof VARIANTS)[number]['id'];

const FEATURES = [
  {
    title: 'One script tag',
    text: 'Your Next.js app serves the chat. Any website, Next.js or not, embeds it with one line.',
  },
  {
    title: 'Answers from your documents',
    text: 'Upload a folder once with kb sync. Every answer cites its sources as links to your pages.',
  },
  {
    title: 'Your own tools',
    text: 'Let the assistant check an order or a price. Arguments are validated with Zod, end to end.',
  },
  {
    title: 'Images, PDFs and voice',
    text: 'Visitors attach files or dictate. The transcript lands in the field for them to check.',
  },
  {
    title: 'Secure by default',
    text: 'Short-lived tokens, rate limits and daily budgets. Visitors never pick the model or tools.',
  },
  {
    title: 'No database',
    text: 'Conversations live in OpenAI. Deploy to Vercel or Heroku with two environment variables.',
  },
] as const;

const EMBED = '<script src="https://your-app.com/api/chat/widget.js?bot=support" async></script>';

const STEPS = [
  {
    title: 'Install',
    text: 'Add the library and zod to your Next.js app.',
    code: 'npm install @boldare/chatdock zod',
  },
  {
    title: 'Set up',
    text: 'init writes the chat route, a bot to start from and the environment template.',
    code: 'npx @boldare/chatdock init',
  },
  {
    title: 'Embed',
    text: 'Paste one tag on any website. The chat is served from your app.',
    code: EMBED,
  },
] as const;

const pick = <T extends string>(value: unknown, options: readonly { readonly id: T }[]): T =>
  options.find((option) => option.id === value)?.id ?? (options[0] as { id: T }).id;

/**
 * The demo and promo page: the same assistant in each theme, as a bubble or inside the page.
 * Switching reloads the page, so the chat starts with the new theme's script.
 */
export default async function Home({ searchParams }: { readonly searchParams: Search }) {
  const params = await searchParams;
  const theme: Theme = pick(params['theme'], THEMES);
  const mode: Mode = pick(params['mode'], MODES);
  const chosen = Object.fromEntries(
    AREAS.map((area) => [area.id, pick(params[area.id], VARIANTS)]),
  ) as Record<Area, Variant>;
  const href = (change: Partial<Record<Area, Variant>> & { theme?: Theme; mode?: Mode }) =>
    `/?${new URLSearchParams({ theme, mode, ...chosen, ...change })}`;
  const inline = mode === 'inline';
  const current = THEMES.find((item) => item.id === theme);

  // The theme and mode switches, in the chosen variant's markup.
  const themeLink = (item: (typeof THEMES)[number], content: ReactNode, className?: string) => (
    <a
      key={item.id}
      className={className}
      href={href({ theme: item.id })}
      aria-current={item.id === theme ? 'true' : undefined}
    >
      {content}
    </a>
  );
  const modeLinks = MODES.map((item) => (
    <a
      key={item.id}
      href={href({ mode: item.id })}
      aria-current={item.id === mode ? 'true' : undefined}
    >
      {item.name}
    </a>
  ));
  const filters = {
    // 1: one card, a labelled row per switch, the theme's note at the bottom.
    '1': (
      <div className="filters control-card">
        <div className="filter-row">
          <span className="filter-label" id="theme-label">
            Theme
          </span>
          <nav className="segmented scroller" aria-labelledby="theme-label">
            {THEMES.map((item) =>
              themeLink(
                item,
                item.id === 'bldr' ? (
                  <>
                    {item.name} <em>custom</em>
                  </>
                ) : (
                  item.name
                ),
              ),
            )}
          </nav>
        </div>
        <div className="filter-row">
          <span className="filter-label" id="mode-label">
            Chat
          </span>
          <nav className="segmented" aria-labelledby="mode-label">
            {modeLinks}
          </nav>
        </div>
        <p className="note">{current?.note}</p>
      </div>
    ),
    // 2: each theme as its shape, a swatch to pick; the mode as a small switch beside them.
    '2': (
      <div className="filters swatches">
        <nav className="swatch-row" aria-label="Theme">
          {THEMES.map((item) =>
            themeLink(
              item,
              <>
                <ShapeIcon theme={item.id} />
                <span>{item.name}</span>
                {item.id === 'bldr' && <em>custom</em>}
              </>,
              'swatch',
            ),
          )}
        </nav>
        <nav className="segmented small" aria-label="Show the chat">
          {modeLinks}
        </nav>
        <p className="note">{current?.note}</p>
      </div>
    ),
    // 3: a dock under the shape, where the eye already is; the copy keeps only the actions.
    '3': (
      <div className="filters dock">
        <nav className="dock-themes" aria-label="Theme">
          {THEMES.map((item) =>
            themeLink(
              item,
              <>
                <ShapeIcon theme={item.id} />
                <span className="tip">{item.name}</span>
              </>,
              'dock-theme',
            ),
          )}
        </nav>
        <span className="dock-divider" aria-hidden="true" />
        <nav className="segmented small" aria-label="Show the chat">
          {modeLinks}
        </nav>
      </div>
    ),
  } satisfies Record<Variant, ReactNode>;

  return (
    <div className="demo" data-theme={theme} data-mode={mode}>
      <aside className="review" aria-label="Design variants">
        <strong>Design variants</strong>
        {AREAS.map((area) => (
          <span key={area.id} className="review-area">
            <span>{area.name}</span>
            {area.variants.map((name, index) => {
              const id = String(index + 1) as Variant;
              return (
                <a
                  key={name}
                  href={href({ [area.id]: id })}
                  aria-current={chosen[area.id] === id ? 'true' : undefined}
                >
                  {id}. {name}
                </a>
              );
            })}
          </span>
        ))}
      </aside>

      <header className="nav">
        <a className="brand" href="https://www.boldare.com" aria-label="Boldare">
          <Image
            src="/boldare-logo.svg"
            alt="Boldare"
            width={133}
            height={16}
            priority
            unoptimized
          />
        </a>
        <span className="product">
          chatdock
          <small>Open source chat for Next.js, on OpenAI</small>
        </span>
        <NavMenu
          links={[
            { href: '#features', label: 'Features' },
            { href: '#how', label: 'How it works' },
            { href: '#themes', label: 'Themes' },
          ]}
          action={{ href: '#how', label: 'Get started' }}
        />
      </header>

      <main>
        <section
          className="hero"
          aria-labelledby="headline"
          data-filters={chosen.filters}
          data-mode={mode}
        >
          <div className="copy">
            <h1 id="headline">
              <span>An</span> <strong>AI assistant</strong> <span>for any website,</span>{' '}
              <strong>in one script tag</strong>
            </h1>
            <p className="lead">
              chatdock is a Next.js library by Boldare. It answers from your documents, calls your
              tools and fits your brand, with security built in.
            </p>
            {chosen.filters === '3' ? (
              <div className="actions">
                <a className="button" href="#how">
                  Get started
                </a>
                <a className="link-button" href="#themes">
                  See the themes
                </a>
              </div>
            ) : (
              filters[chosen.filters]
            )}
          </div>

          <div className="stage">
            {inline ? (
              <div id="chatdock-demo" className="chat-frame" />
            ) : (
              <div className="shape-stage">
                <HeroShape theme={theme} label="Open the chat" />
                <p className="hint">
                  Click the shape, or the button in the corner, to start a chat.
                </p>
              </div>
            )}
            {chosen.filters === '3' && (
              <>
                {filters['3']}
                <p className="note">{current?.note}</p>
              </>
            )}
          </div>
        </section>

        <section
          id="features"
          className="section features"
          aria-labelledby="features-title"
          data-variant={chosen.features}
        >
          <h2 id="features-title">
            <span>Everything a website chat needs,</span> <strong>nothing it doesn't</strong>
          </h2>
          <ul className="cards">
            {FEATURES.map((feature, index) => (
              <li key={feature.title} className="card">
                <span className="dot" aria-hidden="true" />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
                {index === 0 && <code className="feature-code">{EMBED}</code>}
              </li>
            ))}
          </ul>
        </section>

        <section
          id="how"
          className="section how"
          aria-labelledby="how-title"
          data-variant={chosen.how}
        >
          <h2 id="how-title">
            <span>From zero to a working chat</span> <strong>in fifteen minutes</strong>
          </h2>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="card">
                <span className="step">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <code>{step.code}</code>
              </li>
            ))}
          </ol>
          {chosen.how === '3' && (
            <div className="terminal">
              <div className="terminal-bar" aria-hidden="true">
                <i />
                <i />
                <i />
                <span>your-app</span>
              </div>
              <pre>
                {STEPS.map((step, index) => (
                  <span key={step.title} className="terminal-step">
                    <span className="terminal-comment">
                      # {index + 1}. {step.title}
                    </span>
                    {'\n'}
                    {index < 2 ? <span className="terminal-prompt">$ </span> : null}
                    {step.code}
                    {'\n\n'}
                  </span>
                ))}
              </pre>
            </div>
          )}
        </section>

        <section
          id="themes"
          className="section themes-section"
          aria-labelledby="themes-title"
          data-variant={chosen.themes}
        >
          <h2 id="themes-title">
            <span>Four themes,</span> <strong>light and dark</strong>
            <span>, or</span> <strong>your own</strong>
          </h2>
          <ul className="cards themes">
            {PRESETS.map((item) => (
              <li key={item.id} className="card theme-card" data-preview={item.id}>
                <ShapeIcon theme={item.id} />
                <div className="theme-text">
                  <h3>{item.name}</h3>
                  <p>{item.note}</p>
                </div>
                <a href={href({ theme: item.id })}>
                  {item.id === theme ? 'You are looking at it' : `Try ${item.name}`}
                </a>
              </li>
            ))}
            {CUSTOM && (
              <li className="card theme-card custom-card" data-preview={CUSTOM.id}>
                <ShapeIcon theme={CUSTOM.id} />
                <div className="theme-text">
                  <h3>
                    {CUSTOM.name} <em>custom</em>
                  </h3>
                  <p>{CUSTOM.note}</p>
                </div>
                <code>{"defineTheme({ extends: 'halo', tokens: { radius: '0px', … } })"}</code>
                <a href={href({ theme: CUSTOM.id })}>
                  {theme === CUSTOM.id ? 'You are looking at it' : 'See your brand in it'}
                </a>
              </li>
            )}
          </ul>
        </section>
      </main>

      <footer className="footer">
        <Image src="/boldare-logo.svg" alt="Boldare" width={100} height={12} unoptimized />
        <p>
          chatdock is an open-source project by <a href="https://www.boldare.com">Boldare</a>. MIT
          licensed.
        </p>
      </footer>

      <KeepCurrentInView />
      <ChatScript bot={DEMO_BOTS[theme]} {...(inline ? { target: '#chatdock-demo' } : {})} />
    </div>
  );
}
