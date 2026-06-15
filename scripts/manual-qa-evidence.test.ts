import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatManualQaEvidence,
  normalizeManualQaTarget,
  requiredReleaseFiles,
  verifyManualQaEvidence,
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

function completeEvidence(source: string): string {
  return source.replace(/^- \[ \] /gm, "- [x] ").replace("- [x] fail", "- [ ] fail");
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

  it("verifies completed Linux manual QA evidence", async () => {
    const outputFile = join(await tempDir(), "linux-evidence.md");
    const source = formatManualQaEvidence({
      files: requiredReleaseFiles("linux", "5.0.0").map((name) => ({ bytes: 12, name, status: "present" })),
      generatedAt: "2026-06-15T00:00:00.000Z",
      gitSha: "abc123",
      host: { ...host, osPlatform: "linux", osType: "Linux" },
      releaseDir: "/release",
      target: "linux",
      version: "5.0.0"
    });

    await writeFile(outputFile, completeEvidence(source));

    await expect(verifyManualQaEvidence({ evidenceFile: outputFile, target: "linux" })).resolves.toEqual([
      `${outputFile} has all 12 required manual checks marked pass.`,
      `${outputFile} records a passing release file preflight and pass result.`
    ]);
  });

  it("rejects unchecked manual QA evidence", async () => {
    const outputFile = join(await tempDir(), "windows-evidence.md");
    const source = formatManualQaEvidence({
      files: requiredReleaseFiles("windows", "5.0.0").map((name) => ({ bytes: 12, name, status: "present" })),
      generatedAt: "2026-06-15T00:00:00.000Z",
      gitSha: "abc123",
      host,
      releaseDir: "/release",
      target: "windows",
      version: "5.0.0"
    });

    await writeFile(outputFile, source.replace("- [ ] pass", "- [x] pass"));

    await expect(verifyManualQaEvidence({ evidenceFile: outputFile, target: "windows" }))
      .rejects.toThrow("has incomplete manual check: NSIS installer run on Windows 11 x64");
  });

  it("rejects failed manual QA evidence", async () => {
    const outputFile = join(await tempDir(), "windows-evidence.md");
    const source = completeEvidence(formatManualQaEvidence({
      files: requiredReleaseFiles("windows", "5.0.0").map((name) => ({ bytes: 12, name, status: "present" })),
      generatedAt: "2026-06-15T00:00:00.000Z",
      gitSha: "abc123",
      host,
      releaseDir: "/release",
      target: "windows",
      version: "5.0.0"
    })).replace("- [ ] fail", "- [x] fail");

    await writeFile(outputFile, source);

    await expect(verifyManualQaEvidence({ evidenceFile: outputFile, target: "windows" }))
      .rejects.toThrow("marks the manual QA result as fail");
  });

  it("rejects evidence generated on the wrong target OS", async () => {
    const outputFile = join(await tempDir(), "linux-evidence.md");
    const source = completeEvidence(formatManualQaEvidence({
      files: requiredReleaseFiles("linux", "5.0.0").map((name) => ({ bytes: 12, name, status: "present" })),
      generatedAt: "2026-06-15T00:00:00.000Z",
      gitSha: "abc123",
      host: { ...host, osPlatform: "darwin", osType: "Darwin" },
      releaseDir: "/release",
      target: "linux",
      version: "5.0.0"
    }));

    await writeFile(outputFile, source);

    await expect(verifyManualQaEvidence({ evidenceFile: outputFile, target: "linux" }))
      .rejects.toThrow("was not generated on linux");
  });
});
