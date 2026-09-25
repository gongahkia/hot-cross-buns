/**
 * Curated editor and terminal palettes. The semantic layers are derived from
 * each theme's canonical background, foreground, and ANSI accent colors so a
 * palette affects every HCB surface instead of only its application chrome.
 */
export type ThemeMode = "light" | "dark";
export type ThemeSource = "VS Code" | "Ghostty" | "VS Code + Ghostty";
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

const crossPlatform: ThemeSource = "VS Code + Ghostty";

function dark(
  id: string,
  label: string,
  family: string,
  colors: [string, string, string, string, string, string, string],
  source: ThemeSource = crossPlatform
): ThemeSeed {
  const [background, foreground, red, green, yellow, blue, cyan] = colors;
  return { id, label, family, mode: "dark", source, background, foreground, red, green, yellow, blue, cyan };
}

function light(
  id: string,
  label: string,
  family: string,
  colors: [string, string, string, string, string, string, string],
  source: ThemeSource = crossPlatform
): ThemeSeed {
  const [background, foreground, red, green, yellow, blue, cyan] = colors;
  return { id, label, family, mode: "light", source, background, foreground, red, green, yellow, blue, cyan };
}

/**
 * These are the 50 curated themes exposed in Appearance. Most have a matching
 * VS Code port and are bundled by Ghostty via iTerm2-Color-Schemes; One Dark
 * Pro is retained as the heavily installed VS Code edition of Atom One Dark.
 */
const themeSeeds: readonly ThemeSeed[] = [
  dark("one-dark-pro", "One Dark Pro", "one-dark", ["#282c34", "#abb2bf", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#56b6c2"], "VS Code"),
  dark("dracula", "Dracula", "dracula", ["#282a36", "#f8f8f2", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#8be9fd"]),
  dark("dracula-plus", "Dracula+", "dracula", ["#212121", "#f8f8f2", "#ff5555", "#50fa7b", "#ffcb6b", "#82aaff", "#8be9fd"]),
  dark("catppuccin-mocha", "Catppuccin Mocha", "catppuccin", ["#1e1e2e", "#cdd6f4", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#94e2d5"]),
  dark("catppuccin-macchiato", "Catppuccin Macchiato", "catppuccin", ["#24273a", "#cad3f5", "#ed8796", "#a6da95", "#eed49f", "#8aadf4", "#8bd5ca"]),
  dark("catppuccin-frappe", "Catppuccin Frappe", "catppuccin", ["#303446", "#c6d0f5", "#e78284", "#a6d189", "#e5c890", "#8caaee", "#81c8be"]),
  light("catppuccin-latte", "Catppuccin Latte", "catppuccin", ["#eff1f5", "#4c4f69", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#179299"]),
  dark("tokyo-night", "Tokyo Night", "tokyo-night", ["#1a1b26", "#c0caf5", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#7dcfff"]),
  dark("tokyo-night-storm", "Tokyo Night Storm", "tokyo-night", ["#24283b", "#c0caf5", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#7dcfff"]),
  dark("tokyo-night-moon", "Tokyo Night Moon", "tokyo-night", ["#222436", "#c8d3f5", "#ff757f", "#c3e88d", "#ffc777", "#82aaff", "#86e1fc"]),
  light("tokyo-night-day", "Tokyo Night Day", "tokyo-night", ["#e1e2e7", "#3760bf", "#f52a65", "#587539", "#8c6c3e", "#2e7de9", "#007197"]),
  dark("nord", "Nord", "nord", ["#2e3440", "#d8dee9", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#88c0d0"]),
  dark("nord-wave", "Nord Wave", "nord", ["#212121", "#d8dee9", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#88c0d0"]),
  light("nord-light", "Nord Light", "nord", ["#e5e9f0", "#414858", "#bf616a", "#96b17f", "#c5a565", "#81a1c1", "#7bb3c3"]),
  dark("gruvbox-dark", "Gruvbox Dark", "gruvbox", ["#282828", "#ebdbb2", "#cc241d", "#98971a", "#d79921", "#458588", "#689d6a"]),
  dark("gruvbox-dark-hard", "Gruvbox Dark Hard", "gruvbox", ["#1d2021", "#ebdbb2", "#cc241d", "#98971a", "#d79921", "#458588", "#689d6a"]),
  dark("gruvbox-material-dark", "Gruvbox Material Dark", "gruvbox", ["#282828", "#d4be98", "#ea6962", "#a9b665", "#d8a657", "#7daea3", "#89b482"]),
  light("gruvbox-light", "Gruvbox Light", "gruvbox", ["#fbf1c7", "#3c3836", "#cc241d", "#98971a", "#d79921", "#458588", "#689d6a"]),
  light("gruvbox-material-light", "Gruvbox Material Light", "gruvbox", ["#fbf1c7", "#654735", "#c14a4a", "#6c782e", "#b47109", "#45707a", "#4c7a5d"]),
  dark("solarized-dark", "Solarized Dark", "solarized", ["#001e27", "#708284", "#d11c24", "#738a05", "#a57706", "#2176c7", "#259286"]),
  light("solarized-light", "Solarized Light", "solarized", ["#fdf6e3", "#657b83", "#dc322f", "#859900", "#b58900", "#268bd2", "#2aa198"]),
  dark("monokai-pro", "Monokai Pro", "monokai", ["#2d2a2e", "#fcfcfa", "#ff6188", "#a9dc76", "#ffd866", "#fc9867", "#78dce8"]),
  light("monokai-pro-light", "Monokai Pro Light", "monokai", ["#faf4f2", "#29242a", "#e14775", "#269d69", "#cc7a0a", "#e16032", "#1c8ca8"]),
  dark("ayu-dark", "Ayu Dark", "ayu", ["#0b0e14", "#bfbdb6", "#ea6c73", "#7fd962", "#f9af4f", "#53bdfa", "#90e1c6"]),
  dark("ayu-mirage", "Ayu Mirage", "ayu", ["#1f2430", "#cccac2", "#ed8274", "#87d96c", "#facc6e", "#6dcbfa", "#90e1c6"]),
  light("ayu-light", "Ayu Light", "ayu", ["#f8f9fa", "#5c6166", "#ea6c6d", "#6cbf43", "#eca944", "#3199e1", "#46ba94"]),
  dark("github-dark-default", "GitHub Dark Default", "github", ["#0d1117", "#e6edf3", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#39c5cf"]),
  dark("github-dark-dimmed", "GitHub Dark Dimmed", "github", ["#22272e", "#adbac7", "#f47067", "#57ab5a", "#c69026", "#539bf5", "#39c5cf"]),
  light("github-light-default", "GitHub Light Default", "github", ["#ffffff", "#1f2328", "#cf222e", "#116329", "#4d2d00", "#0969da", "#1b7c83"]),
  light("github-light-high-contrast", "GitHub Light High Contrast", "github", ["#ffffff", "#0e1116", "#a0111f", "#024c1a", "#3f2200", "#0349b4", "#1b7c83"]),
  light("material-light", "Material Light", "material", ["#eaeaea", "#232322", "#b7141f", "#457b24", "#f6981e", "#134eb2", "#0e717c"]),
  dark("material-darker", "Material Darker", "material", ["#212121", "#eeffff", "#ff5370", "#c3e88d", "#ffcb6b", "#82aaff", "#89ddff"]),
  dark("material-ocean", "Material Ocean", "material", ["#0f111a", "#8f93a2", "#ff5370", "#c3e88d", "#ffcb6b", "#82aaff", "#89ddff"]),
  dark("night-owl", "Night Owl", "night-owl", ["#011627", "#d6deeb", "#ef5350", "#22da6e", "#addb67", "#82aaff", "#21c7a8"]),
  light("night-owlish-light", "Night Owlish Light", "night-owl", ["#ffffff", "#403f53", "#d3423e", "#2aa298", "#daaa01", "#4876d6", "#08916a"]),
  dark("cobalt2", "Cobalt2", "cobalt", ["#132738", "#ffffff", "#ff0000", "#38de21", "#ffe50a", "#1460d2", "#00bbbb"]),
  dark("shades-of-purple", "Shades of Purple", "shades-of-purple", ["#1e1d40", "#ffffff", "#d90429", "#3ad900", "#ffe700", "#6943ff", "#00c5c7"]),
  dark("synthwave-84", "SynthWave '84", "synthwave", ["#000000", "#dad9c7", "#f6188f", "#1ebb2b", "#fdf834", "#2186ec", "#12c3e2"]),
  dark("rose-pine", "Rosé Pine", "rose-pine", ["#191724", "#e0def4", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#ebbcba"]),
  dark("rose-pine-moon", "Rosé Pine Moon", "rose-pine", ["#232136", "#e0def4", "#eb6f92", "#3e8fb0", "#f6c177", "#9ccfd8", "#ea9a97"]),
  light("rose-pine-dawn", "Rosé Pine Dawn", "rose-pine", ["#faf4ed", "#575279", "#b4637a", "#286983", "#ea9d34", "#56949f", "#d7827e"]),
  dark("kanagawa-wave", "Kanagawa Wave", "kanagawa", ["#1f1f28", "#dcd7ba", "#c34043", "#76946a", "#c0a36e", "#7e9cd8", "#6a9589"]),
  dark("kanagawa-dragon", "Kanagawa Dragon", "kanagawa", ["#181616", "#c5c9c5", "#c4746e", "#8a9a7b", "#c4b28a", "#8ba4b0", "#8ea4a2"]),
  light("kanagawa-lotus", "Kanagawa Lotus", "kanagawa", ["#f2ecbc", "#545464", "#c84053", "#6f894e", "#77713f", "#4d699b", "#597b75"]),
  dark("everforest-dark", "Everforest Dark", "everforest", ["#232a2e", "#d3c6aa", "#e67e80", "#a7c080", "#dbbc7f", "#7fbbb3", "#83c092"]),
  light("everforest-light", "Everforest Light", "everforest", ["#efebd4", "#5c6a72", "#e67e80", "#9ab373", "#c1a266", "#7fbbb3", "#83c092"]),
  dark("atom-one-dark", "Atom One Dark", "one-dark", ["#21252b", "#abb2bf", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#56b6c2"]),
  light("atom-one-light", "Atom One Light", "one-dark", ["#f9f9f9", "#2a2c33", "#de3e35", "#3f953a", "#d2b67c", "#2f5af3", "#3f953a"]),
  dark("oxocarbon", "Oxocarbon", "oxocarbon", ["#161616", "#f2f4f8", "#00dfdb", "#00b4ff", "#ff4297", "#00c15a", "#ff74b8"]),
  dark("vesper", "Vesper", "vesper", ["#101010", "#ffffff", "#f5a191", "#90b99f", "#e6b99d", "#aca1cf", "#ea83a5"])
];

export const colorThemeDefinitions: readonly ColorThemeDefinition[] = themeSeeds.map(defineTheme);
export const appColorThemes = colorThemeDefinitions;
export const customBackgroundThemeId = "custom-background";

const defaultThemeIdByMode: Record<ThemeMode, AppColorThemeId> = {
  dark: "catppuccin-mocha",
  light: "catppuccin-latte"
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
        source: "Ghostty",
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

function defineTheme(seed: ThemeSeed): ColorThemeDefinition {
  return {
    id: seed.id,
    label: seed.label,
    family: seed.family,
    mode: seed.mode,
    isDark: seed.mode === "dark",
    source: seed.source,
    colors: createThemeColors(seed)
  };
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
