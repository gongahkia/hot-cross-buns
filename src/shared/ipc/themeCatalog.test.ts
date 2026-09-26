import { describe, expect, it } from "vitest";
import {
  calendarEventColorForTheme,
  googleCalendarEventColor,
  googleCalendarEventColorIdForApi,
  googleCalendarEventColors,
  resolveCalendarEventDisplayColor
} from "./contracts";
import {
  colorThemeDefinitions,
  customBackgroundThemeId,
  resolveEffectiveColorTheme,
  resolveEffectiveThemeMode,
  semanticThemeVariables,
  themesForMode
} from "./themeCatalog";

describe("theme catalogue", () => {
  it("ships exactly fifty unique, mode-aware palettes", () => {
    expect(colorThemeDefinitions).toHaveLength(50);
    expect(new Set(colorThemeDefinitions.map((theme) => theme.id)).size).toBe(50);
    expect(themesForMode("dark").length).toBeGreaterThan(30);
    expect(themesForMode("light").length).toBeGreaterThan(10);
    expect(colorThemeDefinitions.every((theme) => theme.isDark === (theme.mode === "dark"))).toBe(true);
  });

  it("keeps text, semantic status colors, and accent labels readable", () => {
    for (const theme of colorThemeDefinitions) {
      const { colors } = theme;

      expect(contrast(colors.text, colors.background), theme.label).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.textSecondary, colors.background), theme.label).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.accent, colors.background), theme.label).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.danger, colors.background), theme.label).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.warning, colors.background), theme.label).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.success, colors.background), theme.label).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.info, colors.background), theme.label).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.accentForeground, colors.accent), theme.label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses a paired family where available when the base mode changes", () => {
    expect(resolveEffectiveThemeMode({ theme: "system" }, true)).toBe("dark");
    expect(resolveEffectiveThemeMode({ theme: "system" }, false)).toBe("light");
    expect(resolveEffectiveColorTheme({ colorTheme: "catppuccin-mocha" }, "light").id).toBe("catppuccin-latte");
    expect(resolveEffectiveColorTheme({ colorTheme: "notion" }, "dark").id).toBe("catppuccin-mocha");
  });

  it("returns a complete semantic palette for legacy and new custom backgrounds", () => {
    const legacy = resolveEffectiveColorTheme({
      useInferredBackgroundTheme: true,
      customBackground: { palette: { background: "#202030" } }
    }, "dark");
    const variables = semanticThemeVariables(legacy);

    expect(legacy.id).toBe(customBackgroundThemeId);
    expect(variables["--color-accent-foreground"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(variables["--color-surface-2"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("uses the active palette for Calendar colors while retaining explicit overrides", () => {
    const theme = resolveEffectiveColorTheme({ colorTheme: "dracula" }, "dark");

    expect(calendarEventColorForTheme(theme, "blue").background).toBe(theme.colors.accent);
    expect(resolveCalendarEventDisplayColor({
      colorId: "green",
      colorTheme: theme,
      overrides: { green: { background: "#123456", foreground: "#ffffff" } }
    })).toEqual({ background: "#123456", foreground: "#ffffff" });
  });

  it("maps every standard Google Calendar event colour and upgrades legacy aliases", () => {
    expect(googleCalendarEventColors.map((color) => color.id)).toEqual([
      "default", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"
    ]);
    expect(googleCalendarEventColor("11")).toMatchObject({ label: "Tomato", background: "#dc2127" });
    expect(googleCalendarEventColorIdForApi("blue")).toBe("9");
    expect(googleCalendarEventColorIdForApi("default")).toBeUndefined();
    expect(googleCalendarEventColorIdForApi("not-a-google-colour")).toBeUndefined();
  });
});

function contrast(first: string, second: string): number {
  const luminance = (value: string): number => {
    const components = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
    const linear = components.map((component) => component <= 0.03928
      ? component / 12.92
      : ((component + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
