'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { ShapeTheme } from './palette';
import type { Stage } from './stage';

/** Where the 3D scene runs: a large screen with a mouse. Matches the CSS in demo.css. */
const LIVE = '(min-width: 768px) and (pointer: fine)';

const openChat = () => {
  (window as { chatdock?: (command: 'open') => void }).chatdock?.('open');
};

/**
 * The hero's shape, the theme's symbol, as ferrofluid. On a large screen with a mouse it is a 3D
 * scene: it grows out of a drop, and a click makes its spikes flare where it lands. Phones,
 * reduced motion and browsers without WebGL get a still picture of it instead (rendered by
 * scripts/shape-stills.mjs), and three.js never loads. Either way, a click opens the chat.
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
  const [still, setStill] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (
      !window.matchMedia(LIVE).matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setStill(true);
      return;
    }
    let cancelled = false;
    const fail = (error: unknown) => {
      if (cancelled) return;
      console.error('[hero-shape]', error);
      setStill(true);
    };
    import('./stage')
      .then(({ createStage }) => {
        // Unmounted while loading (development mounts every effect twice): nothing to set up.
        if (cancelled || !canvas.isConnected) return;
        stage.current = createStage(canvas, { theme, onError: fail });
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
      data-still={still || undefined}
      aria-label={label}
      onClick={() => (stage.current ? stage.current.open(openChat) : openChat())}
    >
      <Image
        src={`/shapes/${theme}.webp`}
        alt=""
        width={800}
        height={800}
        sizes="(min-width: 768px) 520px, 80vw"
        priority
      />
      {!still && <canvas ref={canvasRef} />}
    </button>
  );
}
