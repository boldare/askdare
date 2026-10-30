import type { Form } from './forms';

export type ShapeTheme = 'aura' | 'sage' | 'halo' | 'care' | 'bldr';

export interface Palette {
  /** Bottom, middle and top: what the ferrofluid reflects, and the light at its rim. */
  readonly core: readonly [string, string, string];
}

export const PALETTES: Record<ShapeTheme, Palette> = {
  aura: { core: ['#7dd8d0', '#b8a1f6', '#ffa3c6'] },
  sage: { core: ['#6d8c62', '#a9c29b', '#e6eedf'] },
  halo: { core: ['#2a5fd6', '#8fb5ff', '#eef5ff'] },
  care: { core: ['#3730a3', '#7b72e8', '#d9d4ff'] },
  bldr: { core: ['#c4ac12', '#f2da3a', '#fff3a6'] },
};

/** Each theme's shape, its symbol. BLDR, the custom theme, has one of its own. */
export const FORM_OF: Record<ShapeTheme, Form> = {
  aura: 'sphere',
  sage: 'cone',
  halo: 'cylinder',
  care: 'cube',
  bldr: 'octahedron',
};
