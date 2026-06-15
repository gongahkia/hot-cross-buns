import { describe, expect, it } from "vitest";
import {
  evaluateReleaseAssetPreflight,
  matchesUpdateCheckAsset,
  requiredReleaseAssets
} from "./release-asset-preflight";

function asset(name: string) {
  return { name };
}

describe("release asset preflight", () => {
  it("lists required Linux release assets", () => {
    expect(requiredReleaseAssets("linux", "5.0.0")).toEqual([
      "Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage",
      "Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage.sha256",
      "Hot-Cross-Buns-2-linux.AppImage",
      "Hot-Cross-Buns-2-linux.AppImage.sha256",
      "Hot-Cross-Buns-2-linux-x64.AppImage",
      "Hot-Cross-Buns-2-linux-x64.AppImage.sha256",
      "SHASUMS256.txt"
    ]);
  });

  it("lists required Windows release assets", () => {
    expect(requiredReleaseAssets("windows", "5.0.0")).toEqual([
      "Hot-Cross-Buns-2-5.0.0-windows-x64.exe",
      "Hot-Cross-Buns-2-5.0.0-windows-x64.exe.sha256",
      "Hot-Cross-Buns-2-windows.exe",
      "Hot-Cross-Buns-2-windows.exe.sha256",
      "Hot-Cross-Buns-2-windows-x64.exe",
      "Hot-Cross-Buns-2-windows-x64.exe.sha256",
      "SHASUMS256.txt"
    ]);
  });

  it("matches update-check assets for each target", () => {
    expect(matchesUpdateCheckAsset("Hot-Cross-Buns-2-linux-x64.AppImage", "linux")).toBe(true);
    expect(matchesUpdateCheckAsset("Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage", "linux")).toBe(true);
    expect(matchesUpdateCheckAsset("Hot-Cross-Buns-2-linux-arm64.AppImage", "linux")).toBe(false);
    expect(matchesUpdateCheckAsset("Hot-Cross-Buns-2-windows-x64.exe", "windows")).toBe(true);
    expect(matchesUpdateCheckAsset("Hot-Cross-Buns-2-windows.exe", "windows")).toBe(false);
  });

  it("passes when Linux upload and update-check assets are present", () => {
    const result = evaluateReleaseAssetPreflight({
      target: "linux",
      version: "5.0.0",
      assets: requiredReleaseAssets("linux", "5.0.0").map(asset)
    });

    expect(result).toMatchObject({
      ok: true,
      missingAssets: [],
      matchingUpdateAssets: [
        "Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage",
        "Hot-Cross-Buns-2-linux-x64.AppImage"
      ]
    });
  });

  it("fails when only macOS release assets are present", () => {
    const result = evaluateReleaseAssetPreflight({
      target: "windows",
      version: "5.0.0",
      assets: [
        asset("Hot-Cross-Buns-2-5.0.0-mac-arm64.dmg"),
        asset("Hot-Cross-Buns-2-macOS.dmg"),
        asset("SHASUMS256.txt")
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.matchingUpdateAssets).toEqual([]);
    expect(result.missingAssets).toContain("Hot-Cross-Buns-2-5.0.0-windows-x64.exe");
  });
});
