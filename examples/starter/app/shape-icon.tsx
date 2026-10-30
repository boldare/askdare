import { FORM_OF, type ShapeTheme } from './_shape/palette';

/** Light, middle and dark faces, in each theme's colours. */
const TONES: Record<ShapeTheme, readonly [string, string, string]> = {
  aura: ['#f3dcff', '#b8a1f6', '#6b52e0'],
  sage: ['#eaf1e3', '#a9c29b', '#5e7d54'],
  halo: ['#e8f1ff', '#8fb5ff', '#2a5fd6'],
  care: ['#ebe8ff', '#9c95f0', '#3730a3'],
  bldr: ['#fff6b8', '#f2da3a', '#c4ac12'],
};

/**
 * A theme's shape as a flat icon, lit from the top left: the symbol in the themes section, the
 * same form the hero builds in 3D. BLDR gets an ink outline, in Boldare's style.
 */
export function ShapeIcon({ theme }: { readonly theme: ShapeTheme }) {
  const [light, middle, dark] = TONES[theme];
  const id = (name: string) => `shape-${theme}-${name}`;
  const outline = theme === 'bldr' ? { stroke: '#242424', strokeWidth: 1.6 } : {};
  const faces = { strokeLinejoin: 'round' as const, ...outline };
  const side = `url(#${id('side')})`;
  const shapes = {
    sphere: (
      <>
        <circle cx="32" cy="30" r="21" fill={`url(#${id('ball')})`} {...outline} />
        <ellipse cx="24" cy="21" rx="7" ry="4.5" fill="#ffffff" opacity="0.7" />
      </>
    ),
    cone: (
      <>
        <path d="M32 7 L12 47 A20 6 0 0 0 52 47 Z" fill={side} {...faces} />
        <path d="M32 7 L22 46" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="2.5" />
      </>
    ),
    cylinder: (
      <>
        <path d="M14 16 V45 A18 6 0 0 0 50 45 V16 Z" fill={side} {...faces} />
        <ellipse cx="32" cy="16" rx="18" ry="6" fill={light} {...outline} />
      </>
    ),
    cube: (
      <>
        <path d="M32 9 L52 20 L32 31 L12 20 Z" fill={light} {...faces} />
        <path d="M12 20 L32 31 V53 L12 42 Z" fill={middle} {...faces} />
        <path d="M32 31 L52 20 V42 L32 53 Z" fill={dark} {...faces} />
      </>
    ),
    octahedron: (
      <>
        <path d="M32 5 L12 29 L29 35 Z" fill={light} {...faces} />
        <path d="M32 5 L29 35 L52 28 Z" fill={middle} {...faces} />
        <path d="M12 29 L29 35 L32 57 Z" fill={middle} {...faces} />
        <path d="M29 35 L52 28 L32 57 Z" fill={dark} {...faces} />
      </>
    ),
  };
  return (
    <svg className="shape-icon" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <defs>
        <radialGradient id={id('ball')} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor={light} />
          <stop offset="0.5" stopColor={middle} />
          <stop offset="1" stopColor={dark} />
        </radialGradient>
        <linearGradient id={id('side')} x1="0" x2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.45" stopColor={middle} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="58" rx="16" ry="3" fill="currentColor" opacity="0.12" />
      {shapes[FORM_OF[theme]]}
    </svg>
  );
}
