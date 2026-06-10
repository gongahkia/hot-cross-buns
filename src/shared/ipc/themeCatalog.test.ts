import { describe, expect, it } from "vitest";
import {
  appColorThemeIds,
  appColorThemes,
  customBackgroundThemeId,
  inferColorThemePaletteFromSamples,
  resolveAppColorTheme,
  resolveEffectiveColorTheme,
  resolveEffectiveThemeMode,
  resolveAppThemeMode,
  semanticThemeVariables
} from "./themeCatalog";

describe("theme catalog", () => {
  it("keeps legacy built-in color themes available", () => {
    expect(appColorThemeIds).toContain("dracula");
    expect(appColorThemeIds).toContain("catppuccinMocha");
    expect(appColorThemeIds).toContain("hotcrossbuns");
    expect(new Set(appColorThemeIds).size).toBe(appColorThemeIds.length);
    expect(appColorThemes).toHaveLength(appColorThemeIds.length);
  });

  it("resolves base color mode and falls back to a matching palette", () => {
    expect(resolveAppThemeMode("system", true)).toBe("dark");
    expect(resolveAppThemeMode("system", false)).toBe("light");
    expect(resolveAppColorTheme("dracula", "dark").id).toBe("dracula");
    expect(resolveAppColorTheme("dracula", "light").id).toBe("notion");
    expect(resolveAppColorTheme("notion", "dark").id).toBe("oneDarkPro");
  });

  it("derives semantic CSS variables from palette tokens", () => {
    const variables = semanticThemeVariables(resolveAppColorTheme("dracula", "dark"));

    expect(variables["--color-bg-primary"]).toBe("#282A36");
    expect(variables["--color-accent"]).toBe("#FF79C6");
    expect(variables["--color-success"]).toBe("#50FA7B");
    expect(variables["--color-text-secondary"]).toMatch(/^#[\dA-F]{6}$/);
  });

  it("infers custom background palettes and resolves them as effective themes", () => {
    const palette = inferColorThemePaletteFromSamples([
      { red: 12, green: 18, blue: 31 },
      { red: 244, green: 114, blue: 182 },
      { red: 34, green: 197, blue: 94 },
      { red: 56, green: 189, blue: 248 }
    ]);
    const customBackground = {
      fileName: "background.png",
      mimeType: "image/png",
      dataBase64: "abc",
      palette,
      updatedAt: "2026-06-10T00:00:00.000Z"
    };

    expect(palette.isDark).toBe(true);
    expect(palette.ember).toMatch(/^#[\dA-F]{6}$/);
    expect(resolveEffectiveThemeMode({
      theme: "light",
      customBackground,
      useInferredBackgroundTheme: true
    }, false)).toBe("dark");
    expect(resolveEffectiveColorTheme({
      colorTheme: "notion",
      customBackground,
      useInferredBackgroundTheme: true
    }, "dark").id).toBe(customBackgroundThemeId);
    expect(resolveEffectiveColorTheme({
      colorTheme: "notion",
      customBackground,
      useInferredBackgroundTheme: false
    }, "light").id).toBe("notion");
  });
});
