import { describe, expect, it } from "vitest";
import { resolveSyncStatusTheme, syncStatusHtml } from "./syncStatusOverlay";

describe("sync status overlay", () => {
  it("uses selected dark theme colors", () => {
    expect(resolveSyncStatusTheme({
      theme: "dark",
      colorTheme: "dracula"
    }, false)).toMatchObject({
      background: "#282A36",
      text: "#F8F8F2",
      fill: "#FF79C6"
    });
  });

  it("uses selected light theme colors", () => {
    expect(resolveSyncStatusTheme({
      theme: "light",
      colorTheme: "githubLight"
    }, true)).toMatchObject({
      background: "#FFFFFF",
      text: "#24292F",
      fill: "#0969DA"
    });
  });

  it("resolves system theme from the provided system preference", () => {
    expect(resolveSyncStatusTheme({
      theme: "system",
      colorTheme: "notion"
    }, true)).toMatchObject({
      background: "#282C34",
      text: "#ABB2BF"
    });
  });

  it("falls back when the selected color theme does not match the active mode", () => {
    expect(resolveSyncStatusTheme({
      theme: "light",
      colorTheme: "dracula"
    }, false)).toMatchObject({
      background: "#FFFFFF",
      text: "#37352F"
    });
  });

  it("renders selected colors directly without OS media-query overrides", () => {
    const html = syncStatusHtml(3, {
      background: "#111111",
      text: "#EEEEEE",
      muted: "#CCCCCC",
      track: "#333333",
      fill: "#44AAFF"
    });

    expect(html).toContain("--sync-bg: #111111");
    expect(html).toContain("--sync-text: #EEEEEE");
    expect(html).toContain("Queued writes: 3");
    expect(html).not.toContain("prefers-color-scheme");
  });
});
