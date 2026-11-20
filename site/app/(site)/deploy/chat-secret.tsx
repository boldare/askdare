'use client';

import { useEffect, useState } from 'react';

/** 32 random bytes as base64url: 43 characters, what `CHAT_SECRET` needs. */
function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/**
 * A `CHAT_SECRET` made in the visitor's browser, with Copy and New buttons. It is made after
 * hydration, so it is never in the server's HTML, and it is never sent or stored.
 */
export function ChatSecret() {
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => setSecret(newSecret()), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // No clipboard access: the text is selectable, so it can be copied by hand.
      setCopied(false);
    }
  };

  return (
    <div className="secret">
      <output className="secret-value" aria-label="Your CHAT_SECRET">
        {secret || 'Making a secret…'}
      </output>
      <div className="secret-actions">
        <button type="button" className="button small" onClick={copy} disabled={!secret}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setSecret(newSecret());
            setCopied(false);
          }}
        >
          Make a new one
        </button>
      </div>
      <p className="secret-note" aria-live="polite">
        {copied
          ? 'On your clipboard. Paste it into CHAT_SECRET in the Vercel form.'
          : 'Made in your browser. It is never sent anywhere, and this page keeps no copy.'}
      </p>
    </div>
  );
}
