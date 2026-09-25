export type ColorThemeDefinition = any;
export type AppColorThemeDefinition = any;
export type AppColorThemeId = any;
const light: ColorThemeDefinition = { id: "notion", label: "Notion", mode: "light", colors: { background: "#ffffff", surface: "#f7f7f5", text: "#37352f", muted: "#787774", border: "#e9e9e7", accent: "#2383e2", danger: "#e03e3e", warning: "#d9730d", success: "#0f7b6c" } };
const dark: ColorThemeDefinition = { id: "notion-dark", label: "Notion Dark", mode: "dark", colors: { background: "#191919", surface: "#202020", text: "#e6e6e6", muted: "#9b9b9b", border: "#373737", accent: "#529cca", danger: "#eb5757", warning: "#f2a65a", success: "#56b6a7" } };
export const colorThemeDefinitions = [light, dark];
export const appColorThemes: any[] = colorThemeDefinitions;
export const defaultAppColorTheme: any = light;
export const customBackgroundThemeId = "custom-background";
export function resolveEffectiveThemeMode(settings: any, prefersDark: boolean): "light" | "dark" { return settings?.theme === "dark" || (settings?.theme === "system" && prefersDark) ? "dark" : "light"; }
export function resolveEffectiveColorTheme(settings: any, mode: "light" | "dark"): ColorThemeDefinition { return colorThemeDefinitions.find((theme) => theme.id === settings?.colorTheme && theme.mode === mode) ?? (mode === "dark" ? dark : light); }
export const resolveAppColorTheme = resolveEffectiveColorTheme;
export const resolveAppThemeMode = resolveEffectiveThemeMode;
export function semanticThemeVariables(theme: ColorThemeDefinition): Record<string, string> { const c = theme.colors; return { "--color-bg-primary": c.background, "--color-bg-secondary": c.surface, "--color-bg-tertiary": c.surface, "--color-surface-0": c.background, "--color-surface-1": c.surface, "--color-surface-2": c.surface, "--color-text-primary": c.text, "--color-text-secondary": c.muted, "--color-text-muted": c.muted, "--color-border": c.border, "--color-accent": c.accent, "--color-danger": c.danger, "--color-warning": c.warning, "--color-success": c.success, "--color-info": c.accent }; }
export function inferColorThemePaletteFromSamples(samples: Array<{ red: number; green: number; blue: number }>): any { const sample = samples[0] ?? { red: 255, green: 255, blue: 255 }; return { background: `rgb(${sample.red}, ${sample.green}, ${sample.blue})` }; }
