export const appColorThemeIds = [
  "notion",
  "oneDarkPro",
  "githubDark",
  "githubLight",
  "dracula",
  "solarizedDark",
  "solarizedLight",
  "monokai",
  "tokyoNight",
  "materialPalenight",
  "nord",
  "gruvboxDark",
  "gruvboxLight",
  "catppuccinMocha",
  "catppuccinLatte",
  "ayuDark",
  "ayuLight",
  "ayuMirage",
  "nightOwl",
  "oneLight",
  "rosePine",
  "rosePineMoon",
  "rosePineDawn",
  "kanagawa",
  "everforestDark",
  "everforestLight",
  "moonlight",
  "cobalt2",
  "synthwave84",
  "shadesOfPurple",
  "oceanicNext",
  "tomorrowNight",
  "zenburn",
  "horizon",
  "iceberg",
  "pandaSyntax",
  "poimandres",
  "vitesseDark",
  "vitesseLight",
  "hotcrossbuns"
] as const;

export type AppColorThemeId = (typeof appColorThemeIds)[number];
export type AppThemePreference = "system" | "light" | "dark";
export type AppThemeMode = "light" | "dark";

export interface AppColorThemeDefinition {
  id: AppColorThemeId;
  title: string;
  isDark: boolean;
  ember: string;
  moss: string;
  blue: string;
  ink: string;
  cream: string;
  cardStroke: string;
}

export const appColorThemes: readonly AppColorThemeDefinition[] = [
  { id: "notion", title: "Notion", isDark: false, ember: "#2383E2", moss: "#448361", blue: "#2383E2", ink: "#37352F", cream: "#FFFFFF", cardStroke: "#E5E5E5" },
  { id: "oneDarkPro", title: "One Dark Pro", isDark: true, ember: "#E06C75", moss: "#98C379", blue: "#61AFEF", ink: "#ABB2BF", cream: "#282C34", cardStroke: "#3E4451" },
  { id: "githubDark", title: "GitHub Dark", isDark: true, ember: "#58A6FF", moss: "#3FB950", blue: "#58A6FF", ink: "#C9D1D9", cream: "#0D1117", cardStroke: "#30363D" },
  { id: "githubLight", title: "GitHub Light", isDark: false, ember: "#0969DA", moss: "#1A7F37", blue: "#0969DA", ink: "#24292F", cream: "#FFFFFF", cardStroke: "#D0D7DE" },
  { id: "dracula", title: "Dracula", isDark: true, ember: "#FF79C6", moss: "#50FA7B", blue: "#8BE9FD", ink: "#F8F8F2", cream: "#282A36", cardStroke: "#44475A" },
  { id: "solarizedDark", title: "Solarized Dark", isDark: true, ember: "#CB4B16", moss: "#859900", blue: "#268BD2", ink: "#839496", cream: "#002B36", cardStroke: "#073642" },
  { id: "solarizedLight", title: "Solarized Light", isDark: false, ember: "#CB4B16", moss: "#859900", blue: "#268BD2", ink: "#586E75", cream: "#FDF6E3", cardStroke: "#EEE8D5" },
  { id: "monokai", title: "Monokai", isDark: true, ember: "#F92672", moss: "#A6E22E", blue: "#66D9EF", ink: "#F8F8F2", cream: "#272822", cardStroke: "#3E3D32" },
  { id: "tokyoNight", title: "Tokyo Night", isDark: true, ember: "#BB9AF7", moss: "#9ECE6A", blue: "#7DCFFF", ink: "#C0CAF5", cream: "#1A1B26", cardStroke: "#414868" },
  { id: "materialPalenight", title: "Material Palenight", isDark: true, ember: "#C792EA", moss: "#C3E88D", blue: "#82AAFF", ink: "#A6ACCD", cream: "#292D3E", cardStroke: "#444267" },
  { id: "nord", title: "Nord", isDark: true, ember: "#88C0D0", moss: "#A3BE8C", blue: "#81A1C1", ink: "#D8DEE9", cream: "#2E3440", cardStroke: "#3B4252" },
  { id: "gruvboxDark", title: "Gruvbox Dark", isDark: true, ember: "#FE8019", moss: "#B8BB26", blue: "#83A598", ink: "#EBDBB2", cream: "#282828", cardStroke: "#3C3836" },
  { id: "gruvboxLight", title: "Gruvbox Light", isDark: false, ember: "#D65D0E", moss: "#98971A", blue: "#458588", ink: "#3C3836", cream: "#FBF1C7", cardStroke: "#D5C4A1" },
  { id: "catppuccinMocha", title: "Catppuccin Mocha", isDark: true, ember: "#F5C2E7", moss: "#A6E3A1", blue: "#89B4FA", ink: "#CDD6F4", cream: "#1E1E2E", cardStroke: "#313244" },
  { id: "catppuccinLatte", title: "Catppuccin Latte", isDark: false, ember: "#EA76CB", moss: "#40A02B", blue: "#1E66F5", ink: "#4C4F69", cream: "#EFF1F5", cardStroke: "#BCC0CC" },
  { id: "ayuDark", title: "Ayu Dark", isDark: true, ember: "#FFB454", moss: "#AAD94C", blue: "#59C2FF", ink: "#B3B1AD", cream: "#0F1419", cardStroke: "#1F2430" },
  { id: "ayuLight", title: "Ayu Light", isDark: false, ember: "#FF6A00", moss: "#86B300", blue: "#36A3D9", ink: "#5C6773", cream: "#FAFAFA", cardStroke: "#E6E1CF" },
  { id: "ayuMirage", title: "Ayu Mirage", isDark: true, ember: "#FFCC66", moss: "#87D96C", blue: "#73D0FF", ink: "#CBCCC6", cream: "#1F2430", cardStroke: "#171B24" },
  { id: "nightOwl", title: "Night Owl", isDark: true, ember: "#82AAFF", moss: "#ADDB67", blue: "#7FDBCA", ink: "#D6DEEB", cream: "#011627", cardStroke: "#1D3B53" },
  { id: "oneLight", title: "One Light", isDark: false, ember: "#4078F2", moss: "#50A14F", blue: "#4078F2", ink: "#383A42", cream: "#FAFAFA", cardStroke: "#E5E5E6" },
  { id: "rosePine", title: "Rose Pine", isDark: true, ember: "#EBBCBA", moss: "#9CCFD8", blue: "#C4A7E7", ink: "#E0DEF4", cream: "#191724", cardStroke: "#26233A" },
  { id: "rosePineMoon", title: "Rose Pine Moon", isDark: true, ember: "#EA9A97", moss: "#9CCFD8", blue: "#C4A7E7", ink: "#E0DEF4", cream: "#232136", cardStroke: "#393552" },
  { id: "rosePineDawn", title: "Rose Pine Dawn", isDark: false, ember: "#D7827E", moss: "#56949F", blue: "#286983", ink: "#575279", cream: "#FAF4ED", cardStroke: "#DFDAD9" },
  { id: "kanagawa", title: "Kanagawa", isDark: true, ember: "#FFA066", moss: "#98BB6C", blue: "#7E9CD8", ink: "#DCD7BA", cream: "#1F1F28", cardStroke: "#2A2A37" },
  { id: "everforestDark", title: "Everforest Dark", isDark: true, ember: "#E67E80", moss: "#A7C080", blue: "#7FBBB3", ink: "#D3C6AA", cream: "#2D353B", cardStroke: "#3D484D" },
  { id: "everforestLight", title: "Everforest Light", isDark: false, ember: "#F85552", moss: "#8DA101", blue: "#3A94C5", ink: "#5C6A72", cream: "#FDF6E3", cardStroke: "#EFEBD4" },
  { id: "moonlight", title: "Moonlight", isDark: true, ember: "#C099FF", moss: "#C3E88D", blue: "#86E1FC", ink: "#C8D3F5", cream: "#212337", cardStroke: "#2F334D" },
  { id: "cobalt2", title: "Cobalt2", isDark: true, ember: "#FFC600", moss: "#3AD900", blue: "#9EFFFF", ink: "#FFFFFF", cream: "#193549", cardStroke: "#1F4662" },
  { id: "synthwave84", title: "SynthWave '84", isDark: true, ember: "#FF7EDB", moss: "#72F1B8", blue: "#36F9F6", ink: "#F1F1F0", cream: "#241B2F", cardStroke: "#34294F" },
  { id: "shadesOfPurple", title: "Shades of Purple", isDark: true, ember: "#FAD000", moss: "#3AD900", blue: "#9EFFFF", ink: "#F5F5F5", cream: "#2D2B55", cardStroke: "#1E1E3F" },
  { id: "oceanicNext", title: "Oceanic Next", isDark: true, ember: "#F99157", moss: "#99C794", blue: "#6699CC", ink: "#D8DEE9", cream: "#1B2B34", cardStroke: "#343D46" },
  { id: "tomorrowNight", title: "Tomorrow Night", isDark: true, ember: "#CC6666", moss: "#B5BD68", blue: "#81A2BE", ink: "#C5C8C6", cream: "#1D1F21", cardStroke: "#373B41" },
  { id: "zenburn", title: "Zenburn", isDark: true, ember: "#F0DFAF", moss: "#7F9F7F", blue: "#8CD0D3", ink: "#DCDCCC", cream: "#3F3F3F", cardStroke: "#4F4F4F" },
  { id: "horizon", title: "Horizon", isDark: true, ember: "#E95678", moss: "#29D398", blue: "#26BBD9", ink: "#C7C7C7", cream: "#1C1E26", cardStroke: "#2E303E" },
  { id: "iceberg", title: "Iceberg", isDark: true, ember: "#E2A478", moss: "#B5BF77", blue: "#84A0C6", ink: "#C6C8D1", cream: "#161821", cardStroke: "#1E2132" },
  { id: "pandaSyntax", title: "Panda Syntax", isDark: true, ember: "#FF75B5", moss: "#19F9D8", blue: "#45A9F9", ink: "#E6E6E6", cream: "#292A2B", cardStroke: "#3A3B3D" },
  { id: "poimandres", title: "Poimandres", isDark: true, ember: "#89DDFF", moss: "#5DE4C7", blue: "#91B4D5", ink: "#A6ACCD", cream: "#1B1E28", cardStroke: "#303340" },
  { id: "vitesseDark", title: "Vitesse Dark", isDark: true, ember: "#4D9375", moss: "#4D9375", blue: "#6394BF", ink: "#DBD7CA", cream: "#121212", cardStroke: "#393A34" },
  { id: "vitesseLight", title: "Vitesse Light", isDark: false, ember: "#1E754F", moss: "#1E754F", blue: "#2993A3", ink: "#393A34", cream: "#FFFFFF", cardStroke: "#DBD7CA" },
  { id: "hotcrossbuns", title: "Hot Cross Buns", isDark: false, ember: "#F66B3B", moss: "#3C7255", blue: "#1677FF", ink: "#1B1E25", cream: "#FCF4E4", cardStroke: "#DFD3BF" }
] as const;

export const defaultColorThemeIdByMode: Record<AppThemeMode, AppColorThemeId> = {
  light: "notion",
  dark: "oneDarkPro"
};

export function resolveAppThemeMode(
  preference: AppThemePreference,
  systemPrefersDark: boolean
): AppThemeMode {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return preference;
}

export function findAppColorTheme(id: string | null | undefined): AppColorThemeDefinition | undefined {
  return appColorThemes.find((theme) => theme.id === id);
}

export function defaultAppColorTheme(mode: AppThemeMode): AppColorThemeDefinition {
  return findAppColorTheme(defaultColorThemeIdByMode[mode]) ?? appColorThemes[0];
}

export function resolveAppColorTheme(
  id: string | null | undefined,
  mode: AppThemeMode
): AppColorThemeDefinition {
  const requested = findAppColorTheme(id);

  if (requested && requested.isDark === (mode === "dark")) {
    return requested;
  }

  return defaultAppColorTheme(mode);
}

export function semanticThemeVariables(theme: AppColorThemeDefinition): Record<string, string> {
  const background = normalizeHex(theme.cream);
  const text = normalizeHex(theme.ink);
  const surface0 = theme.isDark ? mixHex(background, "#FFFFFF", 0.08) : mixHex(background, "#000000", 0.04);
  const surface1 = theme.isDark ? mixHex(surface0, "#FFFFFF", 0.08) : mixHex(surface0, "#000000", 0.08);
  const surface2 = theme.isDark ? mixHex(surface0, "#FFFFFF", 0.15) : mixHex(surface0, "#000000", 0.15);

  return {
    "--color-bg-primary": background,
    "--color-bg-secondary": theme.isDark
      ? mixHex(background, "#000000", 0.1)
      : mixHex(background, "#000000", 0.03),
    "--color-bg-tertiary": theme.isDark
      ? mixHex(background, "#000000", 0.18)
      : mixHex(background, "#000000", 0.07),
    "--color-surface-0": surface0,
    "--color-surface-1": surface1,
    "--color-surface-2": surface2,
    "--color-text-primary": text,
    "--color-text-secondary": mixHex(text, background, theme.isDark ? 0.18 : 0.22),
    "--color-text-muted": mixHex(text, background, theme.isDark ? 0.34 : 0.42),
    "--color-border": normalizeHex(theme.cardStroke),
    "--color-accent": normalizeHex(theme.ember),
    "--color-danger": theme.isDark ? "#F87171" : "#DC2626",
    "--color-warning": theme.isDark ? "#FBBF24" : "#D97706",
    "--color-success": normalizeHex(theme.moss),
    "--color-info": normalizeHex(theme.blue),
    "--priority-low": normalizeHex(theme.blue),
    "--priority-medium": theme.isDark ? "#FBBF24" : "#D97706",
    "--priority-high": theme.isDark ? "#F87171" : "#DC2626"
  };
}

function normalizeHex(value: string): string {
  const raw = value.trim().replace(/^#/, "");

  if (!/^[\da-f]{6}$/i.test(raw)) {
    return "#000000";
  }

  return `#${raw.toUpperCase()}`;
}

function mixHex(left: string, right: string, rightWeight: number): string {
  const a = parseHex(left);
  const b = parseHex(right);
  const weight = Math.min(1, Math.max(0, rightWeight));

  return rgbToHex({
    red: Math.round(a.red * (1 - weight) + b.red * weight),
    green: Math.round(a.green * (1 - weight) + b.green * weight),
    blue: Math.round(a.blue * (1 - weight) + b.blue * weight)
  });
}

function parseHex(value: string): { red: number; green: number; blue: number } {
  const raw = normalizeHex(value).slice(1);

  return {
    red: Number.parseInt(raw.slice(0, 2), 16),
    green: Number.parseInt(raw.slice(2, 4), 16),
    blue: Number.parseInt(raw.slice(4, 6), 16)
  };
}

function rgbToHex(value: { red: number; green: number; blue: number }): string {
  const channel = (next: number): string =>
    Math.min(255, Math.max(0, next)).toString(16).padStart(2, "0").toUpperCase();

  return `#${channel(value.red)}${channel(value.green)}${channel(value.blue)}`;
}
