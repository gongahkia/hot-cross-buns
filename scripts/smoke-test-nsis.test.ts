import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { smokeWindowsNsisArtifact } from "./smoke-test-nsis";

const versionedInstaller = "Hot-Cross-Buns-2-5.0.0-windows-x64.exe";
const stableInstaller = "Hot-Cross-Buns-2-windows.exe";
const stableX64Installer = "Hot-Cross-Buns-2-windows-x64.exe";

async function createReleaseDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hcb2-nsis-smoke-"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeArtifact(releaseDir: string, name: string, content: string): Promise<string> {
  const filePath = join(releaseDir, name);
  const hash = sha256(content);

  await writeFile(filePath, content);
  await writeFile(`${filePath}.sha256`, `${hash}  ${basename(filePath)}\n`);

  return hash;
}

describe("Windows NSIS smoke test", () => {
  it("verifies versioned and stable installer aliases with checksums", async () => {
    const releaseDir = await createReleaseDir();
    const versionedHash = await writeArtifact(releaseDir, versionedInstaller, "versioned installer");
    const stableHash = await writeArtifact(releaseDir, stableInstaller, "versioned installer");
    const stableX64Hash = await writeArtifact(releaseDir, stableX64Installer, "versioned installer");

    await writeFile(
      join(releaseDir, "SHASUMS256.txt"),
      [
        `${versionedHash}  ${versionedInstaller}`,
        `${stableHash}  ${stableInstaller}`,
        `${stableX64Hash}  ${stableX64Installer}`
      ].join("\n") + "\n"
    );

    await expect(smokeWindowsNsisArtifact({ releaseDir, minimumBytes: 1 })).resolves.toHaveLength(3);
  });

  it("fails when SHASUMS256.txt does not match an installer", async () => {
    const releaseDir = await createReleaseDir();
    const versionedHash = await writeArtifact(releaseDir, versionedInstaller, "versioned installer");
    const stableHash = await writeArtifact(releaseDir, stableInstaller, "versioned installer");
    await writeArtifact(releaseDir, stableX64Installer, "versioned installer");

    await writeFile(
      join(releaseDir, "SHASUMS256.txt"),
      [
        `${versionedHash}  ${versionedInstaller}`,
        `${stableHash}  ${stableInstaller}`,
        `${"0".repeat(64)}  ${stableX64Installer}`
      ].join("\n") + "\n"
    );

    await expect(smokeWindowsNsisArtifact({ releaseDir, minimumBytes: 1 })).rejects.toThrow(
      "SHASUMS256.txt hash does not match Hot-Cross-Buns-2-windows-x64.exe"
    );
  });

  it("fails when a stable installer alias does not match the versioned artifact", async () => {
    const releaseDir = await createReleaseDir();
    const versionedHash = await writeArtifact(releaseDir, versionedInstaller, "versioned installer");
    const stableHash = await writeArtifact(releaseDir, stableInstaller, "wrong alias");
    const stableX64Hash = await writeArtifact(releaseDir, stableX64Installer, "versioned installer");

    await writeFile(
      join(releaseDir, "SHASUMS256.txt"),
      [
        `${versionedHash}  ${versionedInstaller}`,
        `${stableHash}  ${stableInstaller}`,
        `${stableX64Hash}  ${stableX64Installer}`
      ].join("\n") + "\n"
    );

    await expect(smokeWindowsNsisArtifact({ releaseDir, minimumBytes: 1 })).rejects.toThrow(
      "Hot-Cross-Buns-2-windows.exe does not match Hot-Cross-Buns-2-5.0.0-windows-x64.exe"
    );
  });

  it("fails when SHASUMS256.txt contains nested unpacked artifacts", async () => {
    const releaseDir = await createReleaseDir();
    const versionedHash = await writeArtifact(releaseDir, versionedInstaller, "versioned installer");
    const stableHash = await writeArtifact(releaseDir, stableInstaller, "versioned installer");
    const stableX64Hash = await writeArtifact(releaseDir, stableX64Installer, "versioned installer");

    await writeFile(
      join(releaseDir, "SHASUMS256.txt"),
      [
        `${versionedHash}  ${versionedInstaller}`,
        `${stableHash}  ${stableInstaller}`,
        `${stableX64Hash}  ${stableX64Installer}`,
        `${"0".repeat(64)}  win-unpacked\\resources\\elevate.exe`
      ].join("\n") + "\n"
    );

    await expect(smokeWindowsNsisArtifact({ releaseDir, minimumBytes: 1 })).rejects.toThrow(
      "SHASUMS256.txt contains nested artifact win-unpacked\\resources\\elevate.exe"
    );
  });
});
