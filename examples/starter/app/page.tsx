import { headers } from 'next/headers';

export default async function Home() {
  // This app's own address, for the tag below. Behind a proxy (Vercel, Heroku) it comes forwarded.
  const head = await headers();
  const first = (name: string) => head.get(name)?.split(',')[0]?.trim() || undefined;
  const host = first('x-forwarded-host') ?? first('host') ?? 'your-app.com';
  const proto = first('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  return (
    <main>
      <h1>Your Next.js app, with a chat</h1>
      <p>
        The chat button is in the bottom-right corner. The bot is set up in{' '}
        <code>askdare.config.ts</code> and answers through <code>app/api/chat</code>.
      </p>
      <h2>Put it on your website</h2>
      <p>Paste this tag into any page of your site, Next.js or not:</p>
      <pre>
        <code>{`<script src="${origin}/api/chat/widget.js?bot=support" async></script>`}</code>
      </pre>
      <p>
        Then allow your site: add its origin, such as <code>https://www.example.com</code>, to{' '}
        <code>ASKDARE_ALLOWED_ORIGINS</code> (comma-separated). After a one-click deploy, set it in
        your host's environment variables and redeploy; locally, in <code>.env.local</code>.
      </p>
      <h2>Next steps</h2>
      <ul>
        <li>
          Give the bot its job: edit <code>instructions</code> and <code>widget</code> in{' '}
          <code>askdare.config.ts</code>. Where <code>ASKDARE_INSTRUCTIONS</code> or{' '}
          <code>ASKDARE_GREETING</code> are set, as after a one-click deploy, change them there.
        </li>
        <li>
          Check the setup: <code>npx @boldare/askdare doctor</code>.
        </li>
        <li>
          Read the guides in <code>node_modules/@boldare/askdare/docs</code>: knowledge base, tools,
          styling, deployment and going public.
        </li>
      </ul>
    </main>
  );
}
