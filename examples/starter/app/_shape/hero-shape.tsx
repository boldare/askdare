'use client';

import { useEffect, useRef, useState } from 'react';
import { LOOKS, type LookName, type ShapeTheme } from './names';
import type { Stage } from './stage';

const openChat = () => {
  (window as { chatdock?: (command: 'open') => void }).chatdock?.('open');
};

/**
 * The hero's 3D shape, as liquid or as a network. It builds itself
 * when it appears; clicking it sends it to the chat in the corner, opens the chat and builds it
 * again. three.js loads only here, after the page. Without WebGL it falls back to a still orb;
 * with reduced motion it simply appears.
 */
export function HeroShape({
  theme,
  look: initial,
  label,
}: {
  readonly theme: ShapeTheme;
  readonly look: LookName;
  readonly label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const [look, setLook] = useState(initial);
  const lookRef = useRef(initial);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const fail = (error: unknown) => {
      if (cancelled) return;
      console.error('[hero-shape]', error);
      setFallback(true);
    };
    import('./stage')
      .then(({ createStage }) => {
        // Unmounted while loading (development mounts every effect twice): nothing to set up.
        if (cancelled || !canvas.isConnected) return;
        stage.current = createStage(canvas, {
          theme,
          look: lookRef.current,
          reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          onError: fail,
        });
      })
      .catch(fail);
    return () => {
      cancelled = true;
      stage.current?.dispose();
      stage.current = null;
    };
  }, [theme]);

  const choose = (next: LookName) => {
    setLook(next);
    lookRef.current = next;
    stage.current?.show(next);
    // Keep the choice in the address, and in the theme and mode links, which reload the page.
    const url = new URL(window.location.href);
    url.searchParams.set('look', next);
    window.history.replaceState(null, '', url);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="/?"]')) {
      const target = new URL(link.href);
      target.searchParams.set('look', next);
      link.setAttribute('href', `${target.pathname}${target.search}`);
    }
  };

  return (
    <>
      <button
        type="button"
        className="shape"
        data-fallback={fallback || undefined}
        aria-label={label}
        onClick={() => (stage.current ? stage.current.open(openChat) : openChat())}
      >
        {fallback ? <span className="orb" /> : <canvas ref={canvasRef} />}
      </button>
      {!fallback && (
        <fieldset className="segmented looks" aria-label="Shape style">
          {LOOKS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === look}
              onClick={() => choose(item.id)}
            >
              {item.name}
            </button>
          ))}
        </fieldset>
      )}
    </>
  );
}
