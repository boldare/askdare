import './inline.css';
import { getChatConfig } from '@boldare/askdare/next';
import * as Chat from '@boldare/askdare/react';
import { bots } from '@/askdare.config';

type Search = Promise<Record<string, string | string[] | undefined>>;

/** CSS resets a site may have, to check that the chat looks the same with them (e2e/inline.spec.ts). */
const RESETS: Readonly<Record<string, string>> = {
  v3: '/resets/tailwind-v3.css',
  v4: '/resets/tailwind-v4.css',
};

/**
 * The chat inside the page, without an iframe: the default look from @boldare/askdare/react
 * (ADR-0011). A Server Component reads the bot's public configuration and renders the client
 * components directly. The end-to-end tests run against this page.
 */
export default async function InlinePage({ searchParams }: { readonly searchParams: Search }) {
  const params = await searchParams;
  const reset = typeof params.reset === 'string' ? RESETS[params.reset] : undefined;
  const config = getChatConfig({ bots, bot: 'support', locale: 'en' });
  return (
    <main className="inline-page">
      {/* Before the chat, as a site's own stylesheet would be. */}
      {reset && <link rel="stylesheet" href={reset} precedence="site" />}
      <h1>The chat inside a page</h1>
      <p>
        The same assistant as the widget, rendered by React in this page’s own markup. No iframe.
      </p>
      <nav>
        <a href="/inline">Default look</a>
        <a href="/inline/headless">Your own markup</a>
        <a href="/inline?reset=v3">With a Tailwind 3 reset</a>
        <a href="/inline?reset=v4">With a Tailwind 4 reset</a>
        <button type="button">A button of the page</button>
      </nav>
      <Chat.Root config={config}>
        <Chat.DefaultChat className="inline-chat" />
      </Chat.Root>
    </main>
  );
}
