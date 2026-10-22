/**
 * The light and dark palettes from experiment/reference-cal. Stable HCB IDs
 * preserve existing preferences; retired catalogue IDs resolve to these defaults.
 */
export type ThemeMode = "light" | "dark";
export type ThemeSource = "HCB";
export type AppColorThemeId = string;

export interface ThemeColors {
  background: string;
  secondary: string;
  tertiary: string;
  surface0: string;
  surface1: string;
  surface2: string;
  text: string;
  textSecondary: string;
  muted: string;
  border: string;
  accent: string;
  accentForeground: string;
  accentText?: string;
  danger: string;
  warning: string;
  success: string;
  info: string;
}

export interface ColorThemeDefinition {
  id: AppColorThemeId;
  label: string;
  family: string;
  mode: ThemeMode;
  /** Kept for existing consumers while the catalogue uses `mode` internally. */
  isDark: boolean;
  source: ThemeSource;
  colors: ThemeColors;
}

export type AppColorThemeDefinition = ColorThemeDefinition;

type ThemeSettings = Record<string, unknown> & {
  theme?: string | null;
  colorTheme?: string | null;
  customBackground?: { palette?: unknown } | null;
  useInferredBackgroundTheme?: boolean;
};

interface ThemeSeed {
  id: AppColorThemeId;
  label: string;
  family: string;
  mode: ThemeMode;
  source: ThemeSource;
  background: string;
  foreground: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  cyan: string;
}

// Background, sidebar, hover, border and primary colors match the reference.
// Text on coral controls uses a contrasting foreground; plain coral text gets
// a darker variant in light mode so small labels remain readable.
export const colorThemeDefinitions: readonly ColorThemeDefinition[] = [
  {
    id: "hcb-neutral-light", label: "HCB Light", family: "hcb-neutral", mode: "light", isDark: false, source: "HCB",
    colors: {
      background: "#ffffff", secondary: "#f8f8f7", tertiary: "#ffffff",
      surface0: "#f8f8f7", surface1: "#efefef", surface2: "#e5e5e5",
      text: "#32302c", textSecondary: "#73726f", muted: "#797875", border: "#eeeeee",
      accent: "#f04842", accentForeground: "#191919", accentText: "#b23e31",
      danger: "#b23e31", warning: "#855100", success: "#027326", info: "#006cbf"
    }
  },
  {
    id: "hcb-neutral-dark", label: "HCB Dark", family: "hcb-neutral", mode: "dark", isDark: true, source: "HCB",
    colors: {
      background: "#191919", secondary: "#202020", tertiary: "#191919",
      surface0: "#2a2a2a", surface1: "#333333", surface2: "#3d3d3d",
      text: "#d9d9d9", textSecondary: "#a0a0a0", muted: "#7f7f7f", border: "#202020",
      accent: "#f15550", accentForeground: "#191919", accentText: "#f15550",
      danger: "#f15550", warning: "#d4a83a", success: "#52b577", info: "#4895c8"
    }
  }
];
export const appColorThemes = colorThemeDefinitions;
export const customBackgroundThemeId = "custom-background";

const defaultThemeIdByMode: Record<ThemeMode, AppColorThemeId> = {
  dark: "hcb-neutral-dark",
  light: "hcb-neutral-light"
};

export function defaultAppColorTheme(mode: ThemeMode): ColorThemeDefinition {
  return colorThemeDefinitions.find((theme) => theme.id === defaultThemeIdByMode[mode])!;
}

export function resolveAppThemeMode(theme: "system" | ThemeMode | string | null | undefined, prefersDark: boolean): ThemeMode {
  return theme === "dark" || (theme === "system" && prefersDark) ? "dark" : "light";
}

export function resolveEffectiveThemeMode(settings: ThemeSettings | null | undefined, prefersDark: boolean): ThemeMode {
  return resolveAppThemeMode(settings?.theme, prefersDark);
}

export function resolveEffectiveColorTheme(
  settings: ThemeSettings | null | undefined,
  mode: ThemeMode
): ColorThemeDefinition {
  if (settings?.useInferredBackgroundTheme && settings.customBackground?.palette) {
    const colors = normalizeCustomPalette(settings.customBackground.palette, mode);

    if (colors) {
      return {
        id: customBackgroundThemeId,
        label: "Inferred from background",
        family: customBackgroundThemeId,
        mode,
        isDark: mode === "dark",
        source: "HCB",
        colors
      };
    }
  }

  const selected = colorThemeDefinitions.find((theme) => theme.id === settings?.colorTheme);

  if (selected?.mode === mode) {
    return selected;
  }

  if (selected) {
    return colorThemeDefinitions.find((theme) => theme.family === selected.family && theme.mode === mode) ?? defaultAppColorTheme(mode);
  }

  return defaultAppColorTheme(mode);
}

export const resolveAppColorTheme = resolveEffectiveColorTheme;

export function themesForMode(mode: ThemeMode): readonly ColorThemeDefinition[] {
  return colorThemeDefinitions.filter((theme) => theme.mode === mode);
}

export function semanticThemeVariables(theme: ColorThemeDefinition): Record<string, string> {
  const colors = theme.colors;

  return {
    "--color-bg-primary": colors.background,
    "--color-bg-secondary": colors.secondary,
    "--color-bg-tertiary": colors.tertiary,
    "--color-surface-0": colors.surface0,
    "--color-surface-1": colors.surface1,
    "--color-surface-2": colors.surface2,
    "--color-text-primary": colors.text,
    "--color-text-secondary": colors.textSecondary,
    "--color-text-muted": colors.muted,
    "--color-border": colors.border,
    "--color-accent": colors.accent,
    "--color-accent-foreground": colors.accentForeground,
    "--color-accent-text": colors.accentText ?? colors.accent,
    "--color-danger": colors.danger,
    "--color-warning": colors.warning,
    "--color-success": colors.success,
    "--color-info": colors.info,
    "--color-selection-background": colors.accent,
    "--color-selection-foreground": colors.accentForeground,
    "--priority-low": colors.accent,
    "--priority-medium": colors.warning,
    "--priority-high": colors.danger
  };
}

export function inferColorThemePaletteFromSamples(samples: Array<{ red: number; green: number; blue: number; alpha?: number }>): ThemeColors {
  const visible = samples.filter((sample) => (sample.alpha ?? 255) > 24);
  const source = visible.length > 0 ? visible : [{ red: 30, green: 30, blue: 46 }];
  const total = source.reduce(
    (sum, sample) => ({ red: sum.red + sample.red, green: sum.green + sample.green, blue: sum.blue + sample.blue }),
    { red: 0, green: 0, blue: 0 }
  );
  const background = toHex({
    red: total.red / source.length,
    green: total.green / source.length,
    blue: total.blue / source.length
  });
  const mode: ThemeMode = relativeLuminance(background) < 0.42 ? "dark" : "light";
  const fallback = defaultAppColorTheme(mode).colors;

  return createThemeColors({
    background,
    foreground: mode === "dark" ? "#f5f7ff" : "#151820",
    red: fallback.danger,
    green: fallback.success,
    yellow: fallback.warning,
    blue: fallback.accent,
    cyan: fallback.info,
    mode
  });
}

function normalizeCustomPalette(value: unknown, mode: ThemeMode): ThemeColors | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const palette = value as Partial<ThemeColors>;

  if (hasCompleteThemeColors(palette)) {
    return palette;
  }

  return typeof palette.background === "string" && isHexColor(palette.background)
    ? createThemeColors({
      background: palette.background,
      foreground: mode === "dark" ? "#f5f7ff" : "#151820",
      red: mode === "dark" ? "#f38ba8" : "#d20f39",
      green: mode === "dark" ? "#a6e3a1" : "#40a02b",
      yellow: mode === "dark" ? "#fab387" : "#fe640b",
      blue: mode === "dark" ? "#89b4fa" : "#1e66f5",
      cyan: mode === "dark" ? "#89dceb" : "#04a5e5",
      mode
    })
    : null;
}

function hasCompleteThemeColors(value: Partial<ThemeColors>): value is ThemeColors {
  return [
    value.background,
    value.secondary,
    value.tertiary,
    value.surface0,
    value.surface1,
    value.surface2,
    value.text,
    value.textSecondary,
    value.muted,
    value.border,
    value.accent,
    value.accentForeground,
    value.danger,
    value.warning,
    value.success,
    value.info
  ].every((entry) => typeof entry === "string" && isHexColor(entry));
}

function createThemeColors(seed: Pick<ThemeSeed, "background" | "foreground" | "red" | "green" | "yellow" | "blue" | "cyan" | "mode">): ThemeColors {
  const toward = seed.mode === "dark" ? "#ffffff" : "#000000";
  const background = normalizeHex(seed.background);
  const foreground = ensureContrast(normalizeHex(seed.foreground), background, 4.5);
  const textSecondary = ensureContrast(blend(foreground, background, 0.28), background, 4.5);
  const muted = ensureContrast(blend(foreground, background, 0.48), background, 3);
  const accent = ensureContrast(normalizeHex(seed.blue), background, 4.5);

  return {
    background,
    secondary: blend(background, toward, seed.mode === "dark" ? 0.025 : 0.035),
    tertiary: blend(background, toward, seed.mode === "dark" ? 0.07 : 0.07),
    surface0: blend(background, toward, seed.mode === "dark" ? 0.08 : 0.09),
    surface1: blend(background, toward, seed.mode === "dark" ? 0.14 : 0.15),
    surface2: blend(background, toward, seed.mode === "dark" ? 0.21 : 0.22),
    text: foreground,
    textSecondary,
    muted,
    border: blend(background, foreground, seed.mode === "dark" ? 0.16 : 0.18),
    accent,
    accentForeground: preferredForeground(accent),
    danger: ensureContrast(normalizeHex(seed.red), background, 4.5),
    warning: ensureContrast(normalizeHex(seed.yellow), background, 4.5),
    success: ensureContrast(normalizeHex(seed.green), background, 4.5),
    info: ensureContrast(normalizeHex(seed.cyan), background, 4.5)
  };
}

function normalizeHex(value: string): string {
  const normalized = value.trim();
  return isHexColor(normalized) ? normalized.toLowerCase() : "#000000";
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function blend(first: string, second: string, secondWeight: number): string {
  const a = toRgb(first);
  const b = toRgb(second);
  const weight = Math.max(0, Math.min(1, secondWeight));

  return toHex({
    red: a.red + (b.red - a.red) * weight,
    green: a.green + (b.green - a.green) * weight,
    blue: a.blue + (b.blue - a.blue) * weight
  });
}

function ensureContrast(color: string, background: string, minimum: number): string {
  if (contrastRatio(color, background) >= minimum) {
    return color;
  }

  const target = preferredForeground(background);
  let lower = 0;
  let upper = 1;

  for (let step = 0; step < 16; step += 1) {
    const weight = (lower + upper) / 2;
    const candidate = blend(color, target, weight);

    if (contrastRatio(candidate, background) >= minimum) {
      upper = weight;
    } else {
      lower = weight;
    }
  }

  return blend(color, target, upper);
}

function preferredForeground(background: string): string {
  return contrastRatio("#ffffff", background) >= contrastRatio("#0b0d12", background) ? "#ffffff" : "#0b0d12";
}

function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function relativeLuminance(value: string): number {
  const { red, green, blue } = toRgb(value);
  const linear = [red, green, blue].map((component) => {
    const normalized = component / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function toRgb(value: string): { red: number; green: number; blue: number } {
  const normalized = normalizeHex(value);
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16)
  };
}

function toHex(value: { red: number; green: number; blue: number }): string {
  const component = (channel: number): string => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
  return `#${component(value.red)}${component(value.green)}${component(value.blue)}`;
}
