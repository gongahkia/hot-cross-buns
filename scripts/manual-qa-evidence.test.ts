import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeManualQaTarget,
  requiredReleaseFiles,
  writeManualQaEvidence
} from "./manual-qa-evidence";

const host = {
  arch: "x64",
  cwd: "/repo",
  hostname: "qa-host",
  node: "v20.0.0",
  osPlatform: "win32",
  osRelease: "10.0.22631",
  osType: "Windows_NT",
  pnpm: "9.15.4"
};

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hcb2-manual-qa-"));
}

describe("manual QA evidence", () => {
  it("normalizes supported targets", () => {
    expect(normalizeManualQaTarget("linux")).toBe("linux");
    expect(normalizeManualQaTarget("windows")).toBe("windows");
    expect(normalizeManualQaTarget("win32")).toBe("windows");
    expect(() => normalizeManualQaTarget("darwin")).toThrow("Unsupported manual QA target");
  });

  it("lists required Linux release files", () => {
    expect(requiredReleaseFiles("linux", "5.0.0")).toEqual([
      "SHASUMS256.txt",
      "Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage",
      "Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage.sha256",
      "Hot-Cross-Buns-2-linux.AppImage",
      "Hot-Cross-Buns-2-linux.AppImage.sha256",
      "Hot-Cross-Buns-2-linux-x64.AppImage",
      "Hot-Cross-Buns-2-linux-x64.AppImage.sha256"
    ]);
  });

  it("writes Windows evidence with release file preflight", async () => {
    const releaseDir = await tempDir();
    const outputFile = join(await tempDir(), "windows-evidence.md");

    for (const file of requiredReleaseFiles("windows", "5.0.0")) {
      await writeFile(join(releaseDir, file), file);
    }

    const result = await writeManualQaEvidence({
      generatedAt: "2026-06-15T00:00:00.000Z",
      gitSha: "abc123",
      host,
      outputFile,
      releaseDir,
      target: "windows"
    });
    const report = await readFile(result.outputFile, "utf8");

    expect(result.missingFiles).toEqual([]);
    expect(report).toContain("# Windows NSIS Manual QA Evidence");
    expect(report).toContain("| git sha | abc123 |");
    expect(report).toContain("Release file preflight: pass.");
    expect(report).toContain("- [ ] NSIS installer run on Windows 11 x64");
  });

  it("reports missing release files without losing the manual checklist", async () => {
    const releaseDir = await tempDir();
    const outputFile = join(await tempDir(), "linux-evidence.md");
    const result = await writeManualQaEvidence({
      generatedAt: "2026-06-15T00:00:00.000Z",
      gitSha: "abc123",
      host: { ...host, osPlatform: "linux", osType: "Linux" },
      outputFile,
      releaseDir,
      target: "linux"
    });
    const report = await readFile(result.outputFile, "utf8");

    expect(result.missingFiles).toHaveLength(requiredReleaseFiles("linux", "5.0.0").length);
    expect(report).toContain("Release file preflight: fail");
    expect(report).toContain("- [ ] Ubuntu LTS GNOME version and session type recorded");
  });
});
