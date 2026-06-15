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

function completeTargetHostDetails(source: string): string {
  return source
    .replace("- target os:", "- target os: Ubuntu 26.04 LTS")
    .replace("- desktop:", "- desktop: GNOME")
    .replace("- session:", "- session: Wayland")
    .replace("- target windows version:", "- target windows version: Windows 11 25H2")
    .replace("- os build:", "- os build: 26200.8655")
    .replace("- arch:", "- arch: x64")
    .replace("- tester:", "- tester: qa")
    .replace("- evidence attachments:", "- evidence attachments: attached logs and screenshots");
}

function completeEvidence(source: string): string {
  return completeTargetHostDetails(source)
    .replace(/^- \[ \] /gm, "- [x] ")
    .replace("- [x] fail", "- [ ] fail")
    .replace("- notes:", "- notes: Target-host QA evidence recorded.");
}

function completePreUploadEvidence(source: string, postUploadCheck: string): string {
  return completeEvidence(source).replace(`- [x] ${postUploadCheck}`, `- [ ] ${postUploadCheck}`);
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

  await writeFile(
    evidenceFile,
    complete
      ? completeEvidence(source)
      : completeTargetHostDetails(source)
        .replace("- [ ] pass", "- [x] pass")
        .replace("- notes:", "- notes: Target-host QA evidence recorded.")
  );
}

async function writePreUploadEvidenceFile(evidenceFile: string, target: "linux" | "windows"): Promise<void> {
  const postUploadCheck = target === "linux"
    ? "Settings update-check verified only after Linux release assets exist"
    : "Settings update-check verified only after Windows release assets exist";
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

  await writeFile(evidenceFile, completePreUploadEvidence(source, postUploadCheck));
}

async function writeReleaseNotes(notesFile: string, target: "linux" | "windows", blocker = false): Promise<void> {
  const targetText = target === "linux"
    ? [
      "# Linux AppImage technical preview",
      "Ubuntu 26.04 LTS GNOME manual QA passed.",
      "Hot-Cross-Buns-2-linux-x64.AppImage",
      "sha256sum -c SHASUMS256.txt",
      "unsupported notifications, global shortcuts, tray, and hotcrossbuns://"
    ]
    : [
      "# Windows NSIS technical preview",
      "Windows 11 25H2 installed-app manual QA passed.",
      "Hot-Cross-Buns-2-windows-x64.exe",
      "Get-FileHash",
      "unsigned NSIS SmartScreen expectations recorded."
    ];

  await writeFile(notesFile, `${targetText.join("\n")}\n${blocker ? "Publish this artifact only after QA.\n" : ""}`);
}

describe("release upload preflight", () => {
  it("passes with Linux release files and completed manual QA evidence", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "linux-evidence.md");
    const notesFile = join(root, "notes.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, linuxArtifacts);
    await writeEvidenceFile(evidenceFile, "linux");
    await writeReleaseNotes(notesFile, "linux");

    const messages = await verifyReleaseUploadPreflight({
      evidenceFile,
      notesFile,
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
    const notesFile = join(root, "notes.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, windowsArtifacts);
    await writeEvidenceFile(evidenceFile, "windows", false);
    await writeReleaseNotes(notesFile, "windows");

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      notesFile,
      releaseDir,
      target: "windows",
      version: "5.0.0"
    })).rejects.toThrow("has incomplete manual check: NSIS installer run on Windows 11 25H2 x64");
  });

  it("allows upload preflight before post-upload Settings update-check evidence exists", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "linux-evidence.md");
    const notesFile = join(root, "notes.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, linuxArtifacts);
    await writePreUploadEvidenceFile(evidenceFile, "linux");
    await writeReleaseNotes(notesFile, "linux");

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      notesFile,
      releaseDir,
      target: "linux",
      version: "5.0.0"
    })).resolves.toContain("linux release upload preflight passed for 5.0.0.");
  });

  it("fails when a stable alias differs from the versioned artifact", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "windows-evidence.md");
    const notesFile = join(root, "notes.md");
    const manifestLines: string[] = [];

    await mkdir(releaseDir);
    for (const artifact of windowsArtifacts) {
      const content = artifact === "Hot-Cross-Buns-2-windows-x64.exe" ? "wrong alias" : "release artifact";
      const hash = await writeReleaseArtifact(releaseDir, artifact, content);

      manifestLines.push(`${hash}  ${artifact}`);
    }
    await writeFile(join(releaseDir, "SHASUMS256.txt"), `${manifestLines.join("\n")}\n`);
    await writeEvidenceFile(evidenceFile, "windows");
    await writeReleaseNotes(notesFile, "windows");

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      notesFile,
      releaseDir,
      target: "windows",
      version: "5.0.0"
    })).rejects.toThrow("Hot-Cross-Buns-2-windows-x64.exe does not match");
  });

  it("fails while release notes still contain publish blockers", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "linux-evidence.md");
    const notesFile = join(root, "notes.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, linuxArtifacts);
    await writeEvidenceFile(evidenceFile, "linux");
    await writeReleaseNotes(notesFile, "linux", true);

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      notesFile,
      releaseDir,
      target: "linux",
      version: "5.0.0"
    })).rejects.toThrow("still contains release-note blocker phrase");
  });

  it("fails while release notes still say artifacts are prepared for review", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "windows-evidence.md");
    const notesFile = join(root, "notes.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, windowsArtifacts);
    await writeEvidenceFile(evidenceFile, "windows");
    await writeFile(notesFile, [
      "# Windows NSIS technical preview",
      "Windows NSIS artifacts prepared for review.",
      "Windows 11 25H2 installed-app manual QA passed.",
      "Hot-Cross-Buns-2-windows-x64.exe",
      "Get-FileHash",
      "unsigned NSIS SmartScreen expectations recorded."
    ].join("\n"));

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      notesFile,
      releaseDir,
      target: "windows",
      version: "5.0.0"
    })).rejects.toThrow("still contains release-note blocker phrase: prepared for review");
  });

  it("fails when release notes omit target checksum instructions", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "windows-evidence.md");
    const notesFile = join(root, "notes.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, windowsArtifacts);
    await writeEvidenceFile(evidenceFile, "windows");
    await writeFile(notesFile, "# Windows NSIS technical preview\nWindows 11 25H2 unsigned NSIS SmartScreen.\nHot-Cross-Buns-2-windows-x64.exe\n");

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      notesFile,
      releaseDir,
      target: "windows",
      version: "5.0.0"
    })).rejects.toThrow("missing release-note phrase: Get-FileHash");
  });

  it("fails when release notes omit final target manual QA wording", async () => {
    const root = await tempDir();
    const releaseDir = join(root, "release");
    const evidenceFile = join(root, "linux-evidence.md");
    const notesFile = join(root, "notes.md");

    await mkdir(releaseDir);
    await writeReleaseFiles(releaseDir, linuxArtifacts);
    await writeEvidenceFile(evidenceFile, "linux");
    await writeFile(notesFile, [
      "# Linux AppImage technical preview",
      "Ubuntu 26.04 LTS GNOME automated preview gates passed.",
      "Hot-Cross-Buns-2-linux-x64.AppImage",
      "sha256sum -c SHASUMS256.txt",
      "unsupported notifications, global shortcuts, tray, and hotcrossbuns://"
    ].join("\n"));

    await expect(verifyReleaseUploadPreflight({
      evidenceFile,
      notesFile,
      releaseDir,
      target: "linux",
      version: "5.0.0"
    })).rejects.toThrow("missing release-note phrase: Ubuntu 26.04 LTS GNOME manual QA passed");
  });
});
