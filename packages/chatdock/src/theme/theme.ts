import { z } from 'zod';
import { contrastFailures, readableOn } from './contrast';
import {
  PRESET_NAMES,
  PRESETS,
  type PresetName,
  type ThemeTokens,
  type ThemeVariants,
} from './presets';

export type ColorScheme = 'auto' | 'light' | 'dark';

/** A theme built on a preset. Create it with {@link defineTheme} to share it between bots. */
export interface ThemeDefinition {
  /** Preset to start from. Default `halo`. */
  readonly extends?: PresetName;
  /** Brand color for buttons, links and your own messages; text on it is picked for contrast. */
  readonly accent?: string;
  /** Token overrides for the light scheme (and the dark one, unless `dark` sets them). */
  readonly tokens?: Partial<ThemeTokens>;
  /** Token overrides for the dark scheme. */
  readonly dark?: Partial<ThemeTokens>;
  readonly variants?: Partial<ThemeVariants>;
}

export interface ResolvedTheme {
  readonly preset: PresetName;
  readonly colorScheme: ColorScheme;
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
  readonly variants: ThemeVariants;
}

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #1f5fe0');
/**
 * Plain CSS values only: they are written into a stylesheet, and the orb into host pages. No
 * quotes, so no image-set("https://…") or src("…") can make a browser fetch from another origin.
 */
const cssValue = z
  .string()
  .max(600)
  .refine(
    (value) => !/[;{}<>\\"'`]|url\s*\(|@import|expression\s*\(/i.test(value),
    'must be a plain CSS value (no url(), quotes, braces or semicolons)',
  );

const tokensSchema = z
  .object({
    accent: color,
    onAccent: color,
    background: color,
    surface: color,
    text: color,
    muted: color,
    border: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'must be a hex color, alpha allowed'),
    danger: color,
    success: color,
    userBubble: color,
    onUserBubble: color,
    backdrop: cssValue,
    orb: cssValue,
    fontFamily: z
      .string()
      .max(200)
      .regex(/^[\w\s"',.-]+$/, 'must be a font-family list'),
    headingFamily: z
      .string()
      .max(200)
      .regex(/^[\w\s"',.-]+$/, 'must be a font-family list'),
    fontSize: z.string().regex(/^(1[3-9]|20)px$/, 'must be 13px to 20px'),
    radius: z.string().regex(/^([0-9]|[12][0-9]|3[0-2])px$/, 'must be 0px to 32px'),
  })
  .partial()
  .strict();

const variantsSchema = z
  .object({
    avatar: z.enum(['orb', 'icon', 'initials', 'none']),
    welcome: z.enum(['hero', 'persona', 'intro']),
    launcher: z.enum(['orb', 'circle', 'pill']),
    bubbles: z.enum(['filled', 'plain']),
    surface: z.enum(['solid', 'glass']),
    density: z.enum(['comfortable', 'compact']),
    composer: z.enum(['outline', 'gradient']),
  })
  .partial()
  .strict();

export const themeDefinitionSchema: z.ZodType<ThemeDefinition> = z
  .object({
    extends: z.enum(PRESET_NAMES).optional(),
    accent: color.optional(),
    tokens: tokensSchema.optional(),
    dark: tokensSchema.optional(),
    variants: variantsSchema.optional(),
  })
  .strict() as z.ZodType<ThemeDefinition>;

/** Validates a theme once, so several bots can share it. Throws on invalid values. */
export function defineTheme(definition: ThemeDefinition): ThemeDefinition {
  const parsed = themeDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('; ');
    throw new TypeError(`[chatdock] Invalid theme: ${issues}`);
  }
  return Object.freeze(parsed.data);
}

function withAccent(tokens: ThemeTokens, accent: string | undefined): ThemeTokens {
  if (!accent) return tokens;
  const on = readableOn(accent);
  return { ...tokens, accent, onAccent: on, userBubble: accent, onUserBubble: on };
}

/** Preset plus overrides, for both schemes. */
export function resolveTheme(
  theme: PresetName | ThemeDefinition | undefined,
  colorScheme: ColorScheme,
): ResolvedTheme {
  const definition: ThemeDefinition =
    typeof theme === 'string' ? { extends: theme } : (theme ?? {});
  const name = definition.extends ?? 'halo';
  const preset = PRESETS[name];
  const light = { ...withAccent(preset.light, definition.accent), ...definition.tokens };
  const dark = {
    ...withAccent(preset.dark, definition.dark?.accent ?? definition.accent),
    ...definition.tokens,
    ...definition.dark,
  };
  return Object.freeze({
    preset: name,
    colorScheme,
    light: Object.freeze(light),
    dark: Object.freeze(dark),
    variants: Object.freeze({ ...preset.variants, ...definition.variants }),
  });
}

/** Readable-contrast problems of a customized theme, for a development warning. */
export function themeWarnings(theme: ResolvedTheme): string[] {
  const schemes = theme.colorScheme === 'auto' ? (['light', 'dark'] as const) : [theme.colorScheme];
  return schemes.flatMap((scheme) =>
    contrastFailures(theme[scheme]).map(
      (failure) =>
        `${scheme}: ${failure.name} has contrast ${failure.ratio}:1, needs ${failure.required}:1`,
    ),
  );
}
