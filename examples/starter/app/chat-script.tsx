'use client';

import { useEffect } from 'react';

/**
 * Adds the chat's script once React has hydrated the page. The loader adds its own elements
 * (inside `target` in inline mode), and React must never find them while it hydrates.
 */
export function ChatScript({ bot, target }: { readonly bot: string; readonly target?: string }) {
  useEffect(() => {
    // Development runs effects twice; one script is enough.
    if (document.querySelector('script[data-chatdock-demo]')) return;
    const script = document.createElement('script');
    script.src = `/api/chat/widget.js?bot=${encodeURIComponent(bot)}`;
    script.async = true;
    script.dataset['chatdockDemo'] = '';
    if (target) {
      script.dataset['mode'] = 'inline';
      script.dataset['target'] = target;
    }
    document.body.append(script);
  }, [bot, target]);
  return null;
}
