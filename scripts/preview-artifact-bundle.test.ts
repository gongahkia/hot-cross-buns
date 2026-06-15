import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyPreviewArtifactBundle } from "./preview-artifact-bundle";

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

async function createBundleDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hcb2-preview-bundle-"));

  await mkdir(join(dir, "release"), { recursive: true });
  await mkdir(join(dir, "artifacts", "manual-qa"), { recursive: true });
  await mkdir(join(dir, "artifacts", "release"), { recursive: true });
  await mkdir(join(dir, "artifacts", "perf"), { recursive: true });
  await writeFile(join(dir, "artifacts", "release", "bundle-review.json"), "{}");
  await writeFile(join(dir, "artifacts", "release", "bundle-review.md"), "# Bundle Review\n");
  await writeFile(join(dir, "artifacts", "perf", "latest.json"), "{}");
  await writeFile(join(dir, "artifacts", "perf", "latest.md"), "# Perf\n");

  return dir;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeReleaseArtifact(bundleDir: string, name: string, content: string): Promise<string> {
  const filePath = join(bundleDir, "release", name);
  const hash = sha256(content);

  await writeFile(filePath, content);
  await writeFile(`${filePath}.sha256`, `${hash}  ${basename(filePath)}\n`);

  return hash;
}

async function writeBundleRelease(
  bundleDir: string,
  artifactNames: string[],
  content = "release artifact"
): Promise<void> {
  const manifestLines: string[] = [];

  for (const artifact of artifactNames) {
    const hash = await writeReleaseArtifact(bundleDir, artifact, content);

    manifestLines.push(`${hash}  ${artifact}`);
  }

  await writeFile(join(bundleDir, "release", "SHASUMS256.txt"), `${manifestLines.join("\n")}\n`);
}

async function writeEvidence(bundleDir: string, target: "linux" | "windows", pass = true): Promise<void> {
  const title = target === "linux" ? "# Linux AppImage Manual QA Evidence" : "# Windows NSIS Manual QA Evidence";

  await writeFile(
    join(bundleDir, "artifacts", "manual-qa", `${target}-evidence.md`),
    `${title}\n\nRelease file preflight: ${pass ? "pass" : "fail"}.\n`
  );
}

describe("preview artifact bundle verifier", () => {
  it("verifies a Linux preview artifact bundle", async () => {
    const bundleDir = await createBundleDir();

    await writeBundleRelease(bundleDir, linuxArtifacts);
    await writeEvidence(bundleDir, "linux");

    const messages = await verifyPreviewArtifactBundle({ bundleDir, target: "linux", version: "5.0.0" });

    expect(messages.join("\n")).toContain("linux-evidence.md exists");
    expect(messages.join("\n")).toContain("Hot-Cross-Buns-2-linux-x64.AppImage exists");
  });

  it("verifies a Windows preview artifact bundle", async () => {
    const bundleDir = await createBundleDir();

    await writeBundleRelease(bundleDir, windowsArtifacts);
    await writeEvidence(bundleDir, "windows");

    const messages = await verifyPreviewArtifactBundle({ bundleDir, target: "windows", version: "5.0.0" });

    expect(messages.join("\n")).toContain("windows-evidence.md exists");
    expect(messages.join("\n")).toContain("Hot-Cross-Buns-2-windows-x64.exe exists");
  });

  it("fails when a stable alias does not match the versioned artifact", async () => {
    const bundleDir = await createBundleDir();
    const manifestLines: string[] = [];

    for (const artifact of linuxArtifacts) {
      const content = artifact === "Hot-Cross-Buns-2-linux.AppImage" ? "wrong alias" : "release artifact";
      const hash = await writeReleaseArtifact(bundleDir, artifact, content);

      manifestLines.push(`${hash}  ${artifact}`);
    }

    await writeFile(join(bundleDir, "release", "SHASUMS256.txt"), `${manifestLines.join("\n")}\n`);
    await writeEvidence(bundleDir, "linux");

    await expect(
      verifyPreviewArtifactBundle({ bundleDir, target: "linux", version: "5.0.0" })
    ).rejects.toThrow("Hot-Cross-Buns-2-linux.AppImage does not match");
  });

  it("fails when the manual QA evidence template did not pass release preflight", async () => {
    const bundleDir = await createBundleDir();

    await writeBundleRelease(bundleDir, windowsArtifacts);
    await writeEvidence(bundleDir, "windows", false);

    await expect(
      verifyPreviewArtifactBundle({ bundleDir, target: "windows", version: "5.0.0" })
    ).rejects.toThrow("did not record a passing release file preflight");
  });

  it("fails when uploaded perf evidence is missing", async () => {
    const bundleDir = await createBundleDir();

    await writeBundleRelease(bundleDir, linuxArtifacts);
    await writeEvidence(bundleDir, "linux");
    await writeFile(join(bundleDir, "artifacts", "perf", "latest.md"), "");

    const perfJson = join(bundleDir, "artifacts", "perf", "latest.json");
    const original = await readFile(perfJson, "utf8");

    await writeFile(perfJson, "");
    await expect(
      verifyPreviewArtifactBundle({ bundleDir, target: "linux", version: "5.0.0" })
    ).rejects.toThrow("latest.json is empty");
    expect(original).toBe("{}");
  });
});
