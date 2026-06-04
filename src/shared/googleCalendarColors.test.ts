import { describe, expect, it } from "vitest";
import {
  appColorThemeIds
} from "./ipc/themeCatalog";
import {
  googleCalendarEventColor,
  googleCalendarEventColorIds,
  resolveCalendarEventDisplayColor,
  themeCalendarEventColor,
  themeCalendarEventColorMaps
} from "./googleCalendarColors";

describe("Google Calendar event colors", () => {
  it("resolves user overrides before theme defaults and Google defaults", () => {
    expect(resolveCalendarEventDisplayColor({
      colorId: "9",
      colorThemeId: "gruvboxLight",
      overrides: {
        "9": {
          background: "#123456",
          foreground: "#FFFFFF"
        }
      }
    })).toEqual({
      background: "#123456",
      foreground: "#FFFFFF"
    });

    expect(resolveCalendarEventDisplayColor({
      colorId: "9",
      colorThemeId: "gruvboxLight",
      overrides: {}
    })).toEqual(themeCalendarEventColor("gruvboxLight", "9"));
  });

  it("falls back to Google colors, then source calendar colors", () => {
    expect(resolveCalendarEventDisplayColor({
      colorId: "9",
      colorThemeId: null,
      overrides: {}
    })).toEqual({
      background: googleCalendarEventColor("9")?.background,
      foreground: googleCalendarEventColor("9")?.foreground
    });

    expect(resolveCalendarEventDisplayColor({
      colorId: null,
      colorThemeId: "gruvboxLight",
      overrides: {},
      calendarBackgroundColor: "#ABCDEF",
      calendarForegroundColor: "#101010"
    })).toEqual({
      background: "#ABCDEF",
      foreground: "#101010"
    });
  });

  it("covers every app theme and Google event color id with readable colors", () => {
    expect(Object.keys(themeCalendarEventColorMaps).sort()).toEqual([...appColorThemeIds].sort());

    for (const themeId of appColorThemeIds) {
      expect(Object.keys(themeCalendarEventColorMaps[themeId]).sort()).toEqual([...googleCalendarEventColorIds].sort());

      for (const colorId of googleCalendarEventColorIds) {
        const color = themeCalendarEventColor(themeId, colorId);

        expect(color?.background).toMatch(/^#[\dA-F]{6}$/);
        expect(color?.foreground).toMatch(/^#[\dA-F]{6}$/);
        expect(contrastRatio(color!.background, color!.foreground)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const light = Math.max(leftLuminance, rightLuminance);
  const dark = Math.min(leftLuminance, rightLuminance);

  return (light + 0.05) / (dark + 0.05);
}

function relativeLuminance(color: string): number {
  const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((channel) => {
    const normalized = Number.parseInt(channel, 16) / 255;

    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
