export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', lineHeight: 1.6 }}>
      <h1>chatdock starter</h1>
      <p>
        The chat button in the corner is served by this app. Any other website can embed it with one
        tag:
      </p>
      <pre style={{ background: '#f4f6fb', padding: 16, borderRadius: 8, overflowX: 'auto' }}>
        {
          '<script src="https://your-app.example.com/api/chat/widget.js" data-bot="support" async></script>'
        }
      </pre>
      <p>Add the embedding site to CHATDOCK_ALLOWED_ORIGINS first.</p>
      <script src="/api/chat/widget.js" data-bot="support" async />
    </main>
  );
}
