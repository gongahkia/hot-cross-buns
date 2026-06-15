import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatManualQaEvidence } from "./manual-qa-evidence";
import { requiredReleaseAssets } from "./release-asset-preflight";
import { verifyReleaseUploadPreflight } from "./release-upload-preflight";

const linuxArtifacts = [
  "Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage",
  "Hot-Cross-Buns-2-linux.AppImage",
  "Hot-Cross-Buns-2-linux-x64.AppImage"
];
const windowsArtifacts = [
  "Hot-Cross-Buns-2-5.0.0-windows-x64.exe",
  "Hot-Cross-Buns-2-windows.exe",
  "Hot-Cross-Buns-2-windows-x64.exe"
];

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hcb2-release-upload-"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function completeEvidence(source: string): string {
  return source.replace(/^- \[ \] /gm, "- [x] ").replace("- [x] fail", "- [ ] fail");
}

async function writeReleaseArtifact(releaseDir: string, name: string, content: string): Promise<string> {
  const hash = sha256(content);
  const filePath = join(releaseDir, name);

  await writeFile(filePath, content);
  await writeFile(`${filePath}.sha256`, `${hash}  ${basename(filePath)}\n`);

  return hash;
}

async function writeReleaseFiles(releaseDir: string, artifacts: string[], content = "release artifact"): Promise<void> {
  const manifestLines: string[] = [];

  for (const artifact of artifacts) {
    const hash = await writeReleaseArtifact(releaseDir, artifact, content);

    manifestLines.push(`${hash}  ${artifact}`);
  }

  await writeFile(join(releaseDir, "SHASUMS256.txt"), `${manifestLines.join("\n")}\n`);
}

async function writeEvidenceFile(evidenceFile: string, target: "linux" | "windows", complete = true): Promise<void> {
  const source = formatManualQaEvidence({
    files: requiredReleaseAssets(target, "5.0.0").map((name) => ({ bytes: 12, name, status: "present" })),
    generatedAt: "2026-06-15T00:00:00.000Z",
    gitSha: "abc123",
    host: {
      arch: "x64",
      cwd: "/repo",
      hostname: "qa-host",
      node: "v20.0.0",
      osPlatform: target === "linux" ? "linux" : "win32",
      osRelease: target === "linux" ? "6.8.0" : "10.0.22631",
      osType: target === "linux" ? "Linux" : "Windows_NT",
      pnpm: "9.15.4"
    },
    releaseDir: "/release",
    target,
    version: "5.0.0"
  });

  await writeFile(evidenceFile, complete ? completeEvidence(source) : source.replace("- [ ] pass", "- [x] pass"));
}

describe("release upload preflight", () => {
  it("passes with Linux release files and completed manual QA evidence", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "linux-evidence.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, linuxArtifacts);
    await writeEvidenceFile(evidenceFile, "linux");

    const messages = await verifyReleaseUploadPreflight({
      evidenceFile,
      releaseDir,
      target: "linux",
      version: "5.0.0"
    });

    expect(messages.join("\n")).toContain("Hot-Cross-Buns-2-linux-x64.AppImage exists");
    expect(messages.join("\n")).toContain("linux release upload preflight passed for 5.0.0");
  });

  it("fails when manual QA evidence is incomplete", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "windows-evidence.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, windowsArtifacts);
    await writeEvidenceFile(evidenceFile, "windows", false);

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      releaseDir,
      target: "windows",
      version: "5.0.0"
    })).rejects.toThrow("has incomplete manual check: NSIS installer run on Windows 11 x64");
  });

  it("fails when a stable alias differs from the versioned artifact", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "windows-evidence.md");
    const manifestLines: string[] = [];

    await mkdir(releaseDir);
    for (const artifact of windowsArtifacts) {
      const content = artifact === "Hot-Cross-Buns-2-windows-x64.exe" ? "wrong alias" : "release artifact";
      const hash = await writeReleaseArtifact(releaseDir, artifact, content);

      manifestLines.push(`${hash}  ${artifact}`);
    }
    await writeFile(join(releaseDir, "SHASUMS256.txt"), `${manifestLines.join("\n")}\n`);
    await writeEvidenceFile(evidenceFile, "windows");

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      releaseDir,
      target: "windows",
      version: "5.0.0"
    })).rejects.toThrow("Hot-Cross-Buns-2-windows-x64.exe does not match");
  });
});
