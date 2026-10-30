export const PRESET_NAMES = ['halo', 'aura', 'sage', 'care'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

/**
 * Semantic design tokens. Each one becomes a `--ask-*` CSS variable, which is public API
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

/** Component variants a preset picks; each becomes a `data-ask-*` attribute on the document. */
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
  /** Clean and friendly: white into ice blue, a frosted orb in rings of light, a bold question. */
  halo: {
    light: {
      accent: '#1f5fe0',
      onAccent: '#ffffff',
      background: '#ffffff',
      surface: '#eef4fd',
      text: '#0d1526',
      muted: '#4f5b72',
      border: '#0d15261a',
      danger: '#b42318',
      success: '#067647',
      userBubble: '#dce9fc',
      onUserBubble: '#0d1526',
      backdrop:
        'radial-gradient(120% 55% at 50% -10%, #d3e4ff 0%, #ffffff00 65%), linear-gradient(180deg, #f3f8ff 0%, #ffffff 55%, #eef5ff 100%)',
      orb: 'radial-gradient(circle at 36% 28%, #ffffff 0%, #eef5ff 14%, #b4d0ff 44%, #5b8ff2 76%, #2a5fd6 100%)',
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
      userBubble: '#1d3566',
      onUserBubble: '#e9eef8',
      backdrop:
        'radial-gradient(120% 55% at 50% -10%, #1a2b55 0%, #0a0f1c00 65%), linear-gradient(180deg, #0d1528 0%, #0a0f1c 60%)',
      orb: 'radial-gradient(circle at 36% 28%, #ffffff 0%, #d6e5ff 14%, #86aefc 44%, #3466de 76%, #173c9c 100%)',
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

  /**
   * Soft glass for AI products: an airy pastel field, a glossy bubble with its reflection, a
   * two-weight headline. Colors from Boldare's palette: coral, violet and teal.
   */
  aura: {
    light: {
      accent: '#6b52e0',
      onAccent: '#ffffff',
      background: '#fdfbfd',
      surface: '#f5f0f7',
      text: '#242424',
      muted: '#5f5a68',
      border: '#2424241a',
      danger: '#b42318',
      success: '#067647',
      userBubble: '#c2386f',
      onUserBubble: '#ffffff',
      backdrop:
        'radial-gradient(60% 45% at 6% 0%, #ffdbe7 0%, #ffdbe700 70%), radial-gradient(55% 40% at 100% 6%, #e4ddff 0%, #e4ddff00 70%), radial-gradient(70% 45% at 60% 106%, #d2f3ec 0%, #d2f3ec00 70%), linear-gradient(#fdfbfd, #fdfbfd)',
      orb: 'radial-gradient(circle at 33% 24%, #ffffff 0%, #ffffffd9 6%, #ffffff00 19%), radial-gradient(circle at 70% 84%, #9df3e6 0%, #9df3e600 44%), radial-gradient(circle at 50% 28%, #ffa3c6 0%, #f28bbb 24%, #b8a1f6 60%, #7dd8d0 100%)',
      fontFamily: `"Plus Jakarta Sans Variable", ${SYSTEM}`,
      headingFamily: `"Plus Jakarta Sans Variable", ${SYSTEM}`,
      fontSize: '15px',
      radius: '22px',
    },
    dark: {
      accent: '#b9a8ff',
      onAccent: '#1b1530',
      background: '#17141c',
      surface: '#242029',
      text: '#f4f1f8',
      muted: '#b8b0c4',
      border: '#ffffff1c',
      danger: '#ff9c8f',
      success: '#5fdc8f',
      userBubble: '#a52f63',
      onUserBubble: '#ffffff',
      backdrop:
        'radial-gradient(60% 45% at 6% 0%, #4a1f36 0%, #4a1f3600 70%), radial-gradient(55% 40% at 100% 6%, #2c2457 0%, #2c245700 70%), radial-gradient(70% 45% at 60% 106%, #133b37 0%, #133b3700 70%), linear-gradient(#17141c, #17141c)',
      orb: 'radial-gradient(circle at 33% 24%, #ffffff 0%, #ffffffc4 6%, #ffffff00 19%), radial-gradient(circle at 70% 84%, #6fe3d2 0%, #6fe3d200 44%), radial-gradient(circle at 50% 28%, #ff8fb9 0%, #e173aa 24%, #9a83ec 60%, #4fc1b7 100%)',
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

  /** A calm companion: sage and mint, light type, a persona card, black pill buttons. */
  sage: {
    light: {
      accent: '#111311',
      onAccent: '#f5f6f2',
      background: '#f2f3ef',
      surface: '#dde8d3',
      text: '#1a201c',
      muted: '#535b55',
      border: '#1a201c17',
      danger: '#a8261b',
      success: '#2f6b3a',
      userBubble: '#ffffff',
      onUserBubble: '#1a201c',
      backdrop:
        'radial-gradient(80% 50% at 85% 0%, #e0ebd6 0%, #e0ebd600 70%), linear-gradient(180deg, #eef0ea 0%, #f2f3ef 50%)',
      orb: 'radial-gradient(circle at 34% 28%, #ffffff 0%, #e6eedf 26%, #a9c29b 62%, #6d8c62 100%)',
      fontFamily: GEIST,
      headingFamily: GEIST,
      fontSize: '15px',
      radius: '20px',
    },
    dark: {
      accent: '#eef0ea',
      onAccent: '#121512',
      background: '#131613',
      surface: '#26321f',
      text: '#eceee8',
      muted: '#a9b3ab',
      border: '#ffffff1c',
      danger: '#ff9c8f',
      success: '#8fd19b',
      userBubble: '#2a2f2a',
      onUserBubble: '#eceee8',
      backdrop:
        'radial-gradient(80% 50% at 85% 0%, #1f2a1b 0%, #1f2a1b00 70%), linear-gradient(180deg, #171b16 0%, #131613 50%)',
      orb: 'radial-gradient(circle at 34% 28%, #f2f5ee 0%, #c3d3b8 28%, #7c9a70 64%, #3b5137 100%)',
      fontFamily: GEIST,
      headingFamily: GEIST,
      fontSize: '15px',
      radius: '20px',
    },
    variants: {
      avatar: 'orb',
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
