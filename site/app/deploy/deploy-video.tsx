'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The one-click deploy as a short muted loop. It plays by itself unless the visitor asked for
 * reduced motion; then it waits, with the player's controls, on the poster.
 */
export function DeployVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      setStill(query.matches);
      if (query.matches) video.current?.pause();
      else void video.current?.play().catch(() => {});
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  return (
    <figure className="deploy-video">
      <video
        ref={video}
        src="/deploy-flow.mp4"
        poster="/deploy-flow.jpg"
        width={1280}
        height={800}
        muted
        loop
        playsInline
        preload="metadata"
        controls={still}
        aria-label="The one-click deploy: the /deploy page makes the CHAT_SECRET, Vercel deploys the starter, and the new app's chat answers."
      />
      <figcaption>The whole flow, in 19 seconds.</figcaption>
    </figure>
  );
}
