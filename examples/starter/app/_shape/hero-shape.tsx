'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShapeTheme } from './palette';
import type { Stage } from './stage';

const openChat = () => {
  (window as { chatdock?: (command: 'open') => void }).chatdock?.('open');
};

/**
 * The hero's 3D shape, the theme's symbol, as ferrofluid. It grows out of a drop when it appears;
 * a click makes its spikes flare where it lands, and opens the chat. three.js loads only here,
 * after the page. Without WebGL it falls back to a still orb; with reduced motion it simply
 * appears.
 */
export function HeroShape({
  theme,
  label,
}: {
  readonly theme: ShapeTheme;
  readonly label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
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

  return (
    <button
      type="button"
      className="shape"
      data-fallback={fallback || undefined}
      aria-label={label}
      onClick={() => (stage.current ? stage.current.open(openChat) : openChat())}
    >
      {fallback ? <span className="orb" /> : <canvas ref={canvasRef} />}
    </button>
  );
}
