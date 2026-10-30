export default function Home() {
  return (
    <main>
      <h1>Your Next.js app, with a chat</h1>
      <p>
        The chat button is in the bottom-right corner. The bot is set up in{' '}
        <code>askdare.config.ts</code> and answers through <code>app/api/chat</code>.
      </p>
      <h2>Next steps</h2>
      <ul>
        <li>
          Give the bot its job: edit <code>instructions</code> and <code>widget</code> in{' '}
          <code>askdare.config.ts</code>.
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
