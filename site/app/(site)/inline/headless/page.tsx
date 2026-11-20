import '../inline.css';
import { getChatConfig } from '@boldare/askdare/next';
import { bots } from '@/askdare.config';
import { PlainChat } from './plain-chat';

/** The same chat with markup written on this page: only the hooks and primitives (ADR-0011). */
export default function HeadlessPage() {
  const config = getChatConfig({ bots, bot: 'support', locale: 'en' });
  return (
    <main className="inline-page">
      <h1>Your own markup</h1>
      <p>Hooks and primitives from @boldare/askdare/react, styled by this page alone.</p>
      <nav>
        <a href="/inline">Default look</a>
      </nav>
      <PlainChat config={config} />
    </main>
  );
}
