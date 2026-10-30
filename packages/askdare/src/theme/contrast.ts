import type { ThemeTokens } from './presets';

const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

function channels(hex: string): [number, number, number] {
  const match = HEX.exec(hex);
  if (!match?.[1]) throw new TypeError(`Not a hex color: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.x contrast ratio between two opaque hex colors, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/** Black or white, whichever reads better on the given color. */
export function readableOn(background: string): string {
  return contrastRatio('#ffffff', background) >= contrastRatio('#0b0b0b', background)
    ? '#ffffff'
    : '#0b0b0b';
}

export interface ContrastPair {
  readonly name: string;
  readonly foreground: keyof ThemeTokens;
  readonly background: keyof ThemeTokens;
  /** Text needs 4.5 (AA) or 7 (AAA); icons and other non-text parts need 3. */
  readonly kind: 'text' | 'graphic';
}

/** Every pairing a visitor reads in the widget. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { name: 'text on panel', foreground: 'text', background: 'background', kind: 'text' },
  { name: 'text in bubbles', foreground: 'text', background: 'surface', kind: 'text' },
  { name: 'secondary text on panel', foreground: 'muted', background: 'background', kind: 'text' },
  { name: 'secondary text in cards', foreground: 'muted', background: 'surface', kind: 'text' },
  { name: 'button labels', foreground: 'onAccent', background: 'accent', kind: 'text' },
  { name: 'own messages', foreground: 'onUserBubble', background: 'userBubble', kind: 'text' },
  { name: 'links in bubbles', foreground: 'accent', background: 'surface', kind: 'text' },
  { name: 'links on panel', foreground: 'accent', background: 'background', kind: 'text' },
  { name: 'errors', foreground: 'danger', background: 'background', kind: 'text' },
  { name: 'checks', foreground: 'success', background: 'surface', kind: 'graphic' },
];

export interface ContrastFailure {
  readonly name: string;
  readonly ratio: number;
  readonly required: number;
}

/** Pairs below WCAG AA, or AAA for text when `level` is 'AAA'. */
export function contrastFailures(
  tokens: ThemeTokens,
  level: 'AA' | 'AAA' = 'AA',
): ContrastFailure[] {
  return CONTRAST_PAIRS.flatMap((pair) => {
    const required = pair.kind === 'graphic' ? 3 : level === 'AAA' ? 7 : 4.5;
    const ratio = contrastRatio(tokens[pair.foreground], tokens[pair.background]);
    return ratio >= required
      ? []
      : [{ name: pair.name, ratio: Math.round(ratio * 100) / 100, required }];
  });
}
