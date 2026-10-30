import type { Form } from './forms';
import type { ShapeTheme } from './names';

export interface Palette {
  /** The network: ink for nodes and links, an accent for hubs, a light tone for the far side. */
  readonly ramp: readonly [string, string, string];
  /** Bottom, middle and top: what the liquid reflects, and its sheen. */
  readonly core: readonly [string, string, string];
  /** Light travelling through the network: bright accents only, a dark pulse reads as a smudge. */
  readonly pulses: readonly string[];
}

export const PALETTES: Record<ShapeTheme, Palette> = {
  aura: {
    ramp: ['#2b2350', '#6b52e0', '#b8a1f6'],
    core: ['#7dd8d0', '#b8a1f6', '#ffa3c6'],
    pulses: ['#c2386f', '#6b52e0', '#3fcfc0'],
  },
  sage: {
    ramp: ['#1a201c', '#4f6b45', '#a9c29b'],
    core: ['#6d8c62', '#a9c29b', '#e6eedf'],
    pulses: ['#4f6b45', '#7fa36f', '#a9c29b'],
  },
  halo: {
    ramp: ['#0d1526', '#1f5fe0', '#8fb5ff'],
    core: ['#2a5fd6', '#8fb5ff', '#eef5ff'],
    pulses: ['#1f5fe0', '#5b8ff2', '#8fb5ff'],
  },
  care: {
    ramp: ['#111827', '#3730a3', '#7b72e8'],
    core: ['#3730a3', '#7b72e8', '#d9d4ff'],
    pulses: ['#3730a3', '#7b72e8', '#16a34a'],
  },
  bldr: {
    ramp: ['#242424', '#c4ac12', '#9a9a9a'],
    core: ['#c4ac12', '#f2da3a', '#fff3a6'],
    pulses: ['#f2da3a', '#e0c20f', '#c4ac12'],
  },
};

/** Each preset's shape. BLDR, the custom theme, goes through all four. */
export const FORM_OF: Record<ShapeTheme, Form | null> = {
  aura: 'sphere',
  sage: 'cone',
  halo: 'cylinder',
  care: 'cube',
  bldr: null,
};
