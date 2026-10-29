export const PRESET_NAMES = ['halo', 'aura', 'sage', 'care'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

/**
 * Semantic design tokens. Each one becomes a `--cd-*` CSS variable, which is public API
 * (ADR-0008); everything else in the stylesheet is derived from them. Colors are hex.
 */
export interface ThemeTokens {
  /** Buttons, links, focus ring. */
  readonly accent: string;
  /** Text and icons on `accent`. */
  readonly onAccent: string;
  /** Panel background. */
  readonly background: string;
  /** Assistant bubbles, cards and chips. */
  readonly surface: string;
  readonly text: string;
  /** Secondary text: subtitles, timestamps, statuses. */
  readonly muted: string;
  /** Hairlines; the only color that may carry alpha (#rrggbbaa). */
  readonly border: string;
  readonly danger: string;
  /** Confirmations, such as the checks in the intro welcome. */
  readonly success: string;
  readonly userBubble: string;
  readonly onUserBubble: string;
  /** CSS background painted behind the panel, such as a gradient; `none` for flat. */
  readonly backdrop: string;
  /** CSS background of the orb avatar and launcher. */
  readonly orb: string;
  readonly fontFamily: string;
  readonly headingFamily: string;
  readonly fontSize: string;
  readonly radius: string;
}

/** Component variants a preset picks; each becomes a `data-cd-*` attribute on the document. */
export interface ThemeVariants {
  readonly avatar: 'orb' | 'icon' | 'initials' | 'none';
  readonly welcome: 'hero' | 'persona' | 'intro';
  readonly launcher: 'orb' | 'circle' | 'pill';
  readonly bubbles: 'filled' | 'plain';
  readonly surface: 'solid' | 'glass';
  readonly density: 'comfortable' | 'compact';
  readonly composer: 'outline' | 'gradient';
}

export interface Preset {
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
  readonly variants: ThemeVariants;
}

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GEIST = `"Geist Variable", ${SYSTEM}`;

/**
 * The four built-in looks. Inspirations set the mood only; the designs are original (ADR-0008).
 * Every pair a reader sees is checked for contrast in `contrast.test.ts`.
 */
export const PRESETS: Readonly<Record<PresetName, Preset>> = {
  /** Clean and friendly: white into ice blue, a frosted orb, a centered greeting. */
  halo: {
    light: {
      accent: '#1f5fe0',
      onAccent: '#ffffff',
      background: '#ffffff',
      surface: '#eef3fb',
      text: '#0d1526',
      muted: '#4f5b72',
      border: '#0d15261a',
      danger: '#b42318',
      success: '#067647',
      userBubble: '#1f5fe0',
      onUserBubble: '#ffffff',
      backdrop:
        'radial-gradient(140% 60% at 50% -12%, #dce8ff 0%, #ffffff00 62%), linear-gradient(180deg, #f6f9ff 0%, #ffffff 60%)',
      orb: 'radial-gradient(circle at 32% 26%, #ffffff 0%, #dbe8ff 18%, #8fb5ff 48%, #2c66ec 82%, #1d47b8 100%)',
      fontFamily: GEIST,
      headingFamily: GEIST,
      fontSize: '15px',
      radius: '18px',
    },
    dark: {
      accent: '#82adff',
      onAccent: '#06122b',
      background: '#0a0f1c',
      surface: '#151d30',
      text: '#e9eef8',
      muted: '#a0acc3',
      border: '#ffffff1c',
      danger: '#ff9c8f',
      success: '#5fdc8f',
      userBubble: '#2856d1',
      onUserBubble: '#ffffff',
      backdrop:
        'radial-gradient(140% 60% at 50% -12%, #1a2b55 0%, #0a0f1c00 62%), linear-gradient(180deg, #0d1528 0%, #0a0f1c 60%)',
      orb: 'radial-gradient(circle at 32% 26%, #ffffff 0%, #c4d8ff 16%, #6b98ff 46%, #2450c9 80%, #142f82 100%)',
      fontFamily: GEIST,
      headingFamily: GEIST,
      fontSize: '15px',
      radius: '18px',
    },
    variants: {
      avatar: 'orb',
      welcome: 'hero',
      launcher: 'orb',
      bubbles: 'filled',
      surface: 'glass',
      density: 'comfortable',
      composer: 'outline',
    },
  },

  /** Soft glass for AI products: a pastel mesh, an iridescent orb, a gradient composer. */
  aura: {
    light: {
      accent: '#a3159f',
      onAccent: '#ffffff',
      background: '#fdf9ff',
      surface: '#f4ecfa',
      text: '#1d1428',
      muted: '#5b4f6b',
      border: '#1d14281a',
      danger: '#b42318',
      success: '#067647',
      userBubble: '#7b2cbf',
      onUserBubble: '#ffffff',
      backdrop:
        'radial-gradient(55% 40% at 12% 6%, #ffd3ea 0%, #ffd3ea00 70%), radial-gradient(50% 38% at 92% 14%, #d9d0ff 0%, #d9d0ff00 70%), radial-gradient(60% 45% at 75% 100%, #c8f3e4 0%, #c8f3e400 70%), linear-gradient(#fdf9ff, #fdf9ff)',
      orb: 'conic-gradient(from 200deg at 50% 50%, #ff8fc8, #b394ff, #6fe0cc, #ffd08a, #ff8fc8)',
      fontFamily: `"Plus Jakarta Sans Variable", ${SYSTEM}`,
      headingFamily: `"Plus Jakarta Sans Variable", ${SYSTEM}`,
      fontSize: '15px',
      radius: '22px',
    },
    dark: {
      accent: '#f3a6f0',
      onAccent: '#2a0a2a',
      background: '#130d1d',
      surface: '#21182f',
      text: '#f4edff',
      muted: '#bcadd0',
      border: '#ffffff1c',
      danger: '#ff9c8f',
      success: '#5fdc8f',
      userBubble: '#7b2cbf',
      onUserBubble: '#ffffff',
      backdrop:
        'radial-gradient(55% 40% at 12% 6%, #4a1d43 0%, #4a1d4300 70%), radial-gradient(50% 38% at 92% 14%, #2c2357 0%, #2c235700 70%), radial-gradient(60% 45% at 75% 100%, #123c37 0%, #123c3700 70%), linear-gradient(#130d1d, #130d1d)',
      orb: 'conic-gradient(from 200deg at 50% 50%, #ff7dbd, #9d7dff, #4fd1bb, #ffbf6b, #ff7dbd)',
      fontFamily: `"Plus Jakarta Sans Variable", ${SYSTEM}`,
      headingFamily: `"Plus Jakarta Sans Variable", ${SYSTEM}`,
      fontSize: '15px',
      radius: '22px',
    },
    variants: {
      avatar: 'orb',
      welcome: 'hero',
      launcher: 'orb',
      bubbles: 'filled',
      surface: 'glass',
      density: 'comfortable',
      composer: 'gradient',
    },
  },

  /** Calm and editorial: sage neutrals, a serif voice, a persona card, black pill buttons. */
  sage: {
    light: {
      accent: '#171a18',
      onAccent: '#f6f7f2',
      background: '#f6f7f2',
      surface: '#e8ece3',
      text: '#1a201c',
      muted: '#515b54',
      border: '#1a201c1c',
      danger: '#a8261b',
      success: '#2f6b3a',
      userBubble: '#2d3c32',
      onUserBubble: '#f6f7f2',
      backdrop: 'linear-gradient(180deg, #edf1e8 0%, #f6f7f2 45%)',
      orb: 'radial-gradient(circle at 34% 28%, #fbfcf8 0%, #cfdac7 30%, #8ba383 64%, #4f6a4a 100%)',
      fontFamily: GEIST,
      headingFamily: '"Fraunces", Georgia, "Times New Roman", serif',
      fontSize: '15px',
      radius: '16px',
    },
    dark: {
      accent: '#eceee8',
      onAccent: '#121512',
      background: '#121512',
      surface: '#1d231f',
      text: '#eceee8',
      muted: '#a7b1aa',
      border: '#ffffff1c',
      danger: '#ff9c8f',
      success: '#8fd19b',
      userBubble: '#33473a',
      onUserBubble: '#eceee8',
      backdrop: 'linear-gradient(180deg, #171c18 0%, #121512 45%)',
      orb: 'radial-gradient(circle at 34% 28%, #f2f5ee 0%, #b9c8b0 30%, #6f8a68 64%, #3b5137 100%)',
      fontFamily: GEIST,
      headingFamily: '"Fraunces", Georgia, "Times New Roman", serif',
      fontSize: '15px',
      radius: '16px',
    },
    variants: {
      avatar: 'initials',
      welcome: 'persona',
      launcher: 'pill',
      bubbles: 'filled',
      surface: 'solid',
      density: 'comfortable',
      composer: 'outline',
    },
  },

  /** Trust first: indigo and lavender, a capability checklist, hyperlegible type, AAA text. */
  care: {
    light: {
      accent: '#3730a3',
      onAccent: '#ffffff',
      background: '#ffffff',
      surface: '#f0eeff',
      text: '#111827',
      muted: '#3d4455',
      border: '#11182726',
      danger: '#97170e',
      success: '#05603a',
      userBubble: '#3730a3',
      onUserBubble: '#ffffff',
      backdrop: 'none',
      orb: 'radial-gradient(circle at 34% 28%, #ffffff 0%, #d9d4ff 30%, #7b72e8 66%, #3730a3 100%)',
      fontFamily: `"Atkinson Hyperlegible Next Variable", ${SYSTEM}`,
      headingFamily: `"Atkinson Hyperlegible Next Variable", ${SYSTEM}`,
      fontSize: '16px',
      radius: '14px',
    },
    dark: {
      accent: '#c9d0ff',
      onAccent: '#0e1020',
      background: '#0e1020',
      surface: '#1c1f3a',
      text: '#f5f6fb',
      muted: '#ccd0e4',
      border: '#ffffff26',
      danger: '#ffc2b8',
      success: '#86efbd',
      userBubble: '#3730a3',
      onUserBubble: '#ffffff',
      backdrop: 'none',
      orb: 'radial-gradient(circle at 34% 28%, #ffffff 0%, #cfc9ff 30%, #7b72e8 66%, #3730a3 100%)',
      fontFamily: `"Atkinson Hyperlegible Next Variable", ${SYSTEM}`,
      headingFamily: `"Atkinson Hyperlegible Next Variable", ${SYSTEM}`,
      fontSize: '16px',
      radius: '14px',
    },
    variants: {
      avatar: 'icon',
      welcome: 'intro',
      launcher: 'pill',
      bubbles: 'filled',
      surface: 'solid',
      density: 'comfortable',
      composer: 'outline',
    },
  },
};
