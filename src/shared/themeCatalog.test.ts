import { describe, expect, it } from "vitest";
import {
  appColorThemeIds,
  appColorThemes,
  resolveAppColorTheme,
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
});
