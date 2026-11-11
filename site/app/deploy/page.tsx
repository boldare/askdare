import type { Metadata } from 'next';
import { DEMO_BOTS } from '@/askdare.config';
import { ChatScript } from '../chat-script';
import { PREVIEW } from '../preview';
import { SiteFooter, SiteHeader } from '../site-chrome';
import { ChatSecret } from './chat-secret';
import { HEROKU_DOCS, VERCEL_DEPLOY_URL } from './clone-url';
import './deploy.css';

const title = 'Your own AI chatbot, online in five minutes · askdare';
const description =
  'Deploy the askdare starter to Vercel in one click: a Next.js app with an AI chat on your own OpenAI key. No database, no code to write.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: { type: 'website', siteName: 'askdare', title, description, images: [PREVIEW] },
  twitter: { card: 'summary_large_image', title, description, images: [PREVIEW] },
};

const AFTER = [
  {
    title: 'Talk to it',
    text: 'Open your new app: the chat is in the corner, answering with your key and model.',
  },
  {
    title: 'Give it its job',
    text: 'Change ASKDARE_INSTRUCTIONS and ASKDARE_GREETING in your Vercel project, then redeploy.',
  },
  {
    title: 'Put it on your site',
    text: 'Your app shows the script tag to paste. Add your site to ASKDARE_ALLOWED_ORIGINS.',
  },
] as const;

/** The Vercel triangle, as in Vercel's own deploy button. */
function VercelIcon() {
  return (
    <svg className="vercel-icon" viewBox="0 0 76 65" aria-hidden="true" focusable="false">
      <path d="M37.53 0 75.06 65H0z" fill="currentColor" />
    </svg>
  );
}

/** The one-click deploy, step by step: an OpenAI key, a secret made here, the Vercel button. */
export default function Deploy() {
  return (
    <div className="demo deploy" data-theme="aura">
      <SiteHeader
        links={[
          { href: '/#features', label: 'Features' },
          { href: '/#how', label: 'How it works' },
          { href: '/#themes', label: 'Themes' },
          { href: '/docs', label: 'Docs' },
        ]}
        action={{ href: '/docs/getting-started', label: 'Get started' }}
      />

      <main>
        <section className="section deploy-intro" aria-labelledby="headline">
          <h1 id="headline">
            <span>Your own</span> <strong>AI chatbot</strong>, <span>online in</span>{' '}
            <strong>five minutes</strong>
          </h1>
          <p className="lead">
            Deploy the askdare starter to Vercel: a Next.js app with one chatbot, in your own
            repository, on your own OpenAI key. No database, no code to write. The chat in the
            corner of this page is what you get.
          </p>
        </section>

        <ol className="section deploy-steps" aria-label="Three steps">
          <li className="card">
            <span className="step">1</span>
            <h2>Get an OpenAI key</h2>
            <p>
              Create a project just for this chat on the OpenAI platform, give it a monthly budget
              under <strong>Limits</strong>, and create a key in it. You pay OpenAI only for what
              the chat uses, and the budget caps it.
            </p>
            <a
              className="link-button"
              href="https://platform.openai.com/settings/organization/projects"
            >
              Open OpenAI projects
            </a>
          </li>

          <li className="card">
            <span className="step">2</span>
            <h2>Copy your CHAT_SECRET</h2>
            <p>It signs your visitors' sessions. We made one for you:</p>
            <ChatSecret />
          </li>

          <li className="card">
            <span className="step">3</span>
            <h2>Deploy</h2>
            <p>
              Vercel copies the starter to a new repository on your Git account and asks for the
              variables. Paste the key and the secret; the rest comes filled in.
            </p>
            <a className="button deploy-button" href={VERCEL_DEPLOY_URL}>
              <VercelIcon />
              Deploy to Vercel
            </a>
            <a className="more" href={HEROKU_DOCS}>
              Prefer Heroku? <span className="arrow">→</span>
            </a>
          </li>
        </ol>

        <section className="section deploy-after" aria-labelledby="after-title">
          <h2 id="after-title">
            <span>When the build is done,</span> <strong>it's yours</strong>
          </h2>
          <ul className="features-list">
            {AFTER.map((item) => (
              <li key={item.title}>
                <span className="dot" aria-hidden="true" />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
          <div className="actions">
            <a className="button" href="/docs/getting-started">
              Add it to your own app
            </a>
            <a className="link-button" href="/docs/deployment#one-click-deploy">
              Deployment in the docs
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
      <ChatScript bot={DEMO_BOTS.aura} />
    </div>
  );
}
