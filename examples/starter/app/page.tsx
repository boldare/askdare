import Image from 'next/image';
import { DEMO_BOTS } from '@/chatdock.config';
import { ChatScript } from './chat-script';
import { HeroShape } from './hero-shape';

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

const STEPS = [
  { title: 'Install', code: 'npm install @boldare/chatdock zod' },
  { title: 'Set up', code: 'npx @boldare/chatdock init' },
  {
    title: 'Embed',
    code: '<script src="https://your-app.com/api/chat/widget.js?bot=support" async></script>',
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
  const href = (change: { theme?: Theme; mode?: Mode }) =>
    `/?${new URLSearchParams({ theme, mode, ...change })}`;
  const inline = mode === 'inline';

  return (
    <div className="demo" data-theme={theme} data-mode={mode}>
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
        <nav aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#themes">Themes</a>
        </nav>
        <a className="button small" href="#how">
          Get started
        </a>
      </header>

      <main>
        <section className="hero" aria-labelledby="headline">
          <div className="copy">
            <h1 id="headline">
              <span>An</span> <strong>AI assistant</strong> <span>for any website,</span>{' '}
              <strong>in one script tag</strong>
            </h1>
            <p className="lead">
              chatdock is a Next.js library by Boldare. It answers from your documents, calls your
              tools and fits your brand, with security built in.
            </p>

            <div className="switches">
              <fieldset>
                <legend>Theme</legend>
                <div className="segmented">
                  {PRESETS.map((item) => (
                    <a
                      key={item.id}
                      href={href({ theme: item.id })}
                      aria-current={item.id === theme ? 'true' : undefined}
                    >
                      {item.name}
                    </a>
                  ))}
                  {CUSTOM && (
                    <a
                      className="custom"
                      href={href({ theme: CUSTOM.id })}
                      aria-current={theme === CUSTOM.id ? 'true' : undefined}
                    >
                      {CUSTOM.name} <em>custom</em>
                    </a>
                  )}
                </div>
              </fieldset>
              <fieldset>
                <legend>Show the chat</legend>
                <div className="segmented">
                  {MODES.map((item) => (
                    <a
                      key={item.id}
                      href={href({ mode: item.id })}
                      aria-current={item.id === mode ? 'true' : undefined}
                    >
                      {item.name}
                    </a>
                  ))}
                </div>
              </fieldset>
            </div>
            <p className="note">{THEMES.find((item) => item.id === theme)?.note}</p>
          </div>

          <div className="stage">
            {inline ? (
              <div id="chatdock-demo" className="chat-frame" />
            ) : (
              <div className="orb-stage">
                <HeroShape theme={theme} label="Open the chat" />
                <p>Click the shape, or the button in the corner, to start a chat.</p>
              </div>
            )}
          </div>
        </section>

        <section id="features" className="section" aria-labelledby="features-title">
          <h2 id="features-title">
            <span>Everything a website chat needs,</span> <strong>nothing it doesn't</strong>
          </h2>
          <ul className="cards">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="card">
                <span className="dot" aria-hidden="true" />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className="section" aria-labelledby="how-title">
          <h2 id="how-title">
            <span>From zero to a working chat</span> <strong>in fifteen minutes</strong>
          </h2>
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="card">
                <span className="step">{index + 1}</span>
                <h3>{step.title}</h3>
                <code>{step.code}</code>
              </li>
            ))}
          </ol>
        </section>

        <section id="themes" className="section" aria-labelledby="themes-title">
          <h2 id="themes-title">
            <span>Four themes,</span> <strong>light and dark</strong>
            <span>, or</span> <strong>your own</strong>
          </h2>
          <ul className="cards themes">
            {PRESETS.map((item) => (
              <li key={item.id} className="card" data-preview={item.id}>
                <span className="mini-orb" aria-hidden="true" />
                <h3>{item.name}</h3>
                <p>{item.note}</p>
                <a href={href({ theme: item.id })}>
                  {item.id === theme ? 'You are looking at it' : `Try ${item.name}`}
                </a>
              </li>
            ))}
            {CUSTOM && (
              <li className="card custom-card" data-preview={CUSTOM.id}>
                <span className="mini-orb" aria-hidden="true" />
                <h3>
                  {CUSTOM.name} <em>custom</em>
                </h3>
                <p>{CUSTOM.note}</p>
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

      <ChatScript bot={DEMO_BOTS[theme]} {...(inline ? { target: '#chatdock-demo' } : {})} />
    </div>
  );
}
