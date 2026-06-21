import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeLinuxPreviewArtifacts } from "./linux-preview-artifacts";
import { writeWindowsPreviewArtifacts } from "./windows-preview-artifacts";

async function createReleaseDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hcb2-preview-artifacts-"));
}

describe("preview artifact aliases", () => {
  it("copies only versioned Linux AppImage artifacts into stable aliases", async () => {
    const releaseDir = await createReleaseDir();

    await writeFile(join(releaseDir, "helper-linux-x64.AppImage"), "wrong");
    await writeFile(join(releaseDir, "Hot-Cross-Buns-2-linux.AppImage"), "old stable");
    const versionedAppImage = join(releaseDir, "Hot-Cross-Buns-2-5.0.0-linux-x86_64.AppImage");

    await writeFile(versionedAppImage, "linux appimage");
    await chmod(versionedAppImage, 0o755);

    await expect(writeLinuxPreviewArtifacts({ releaseDir })).resolves.toHaveLength(2);
    await expect(readFile(join(releaseDir, "Hot-Cross-Buns-2-linux.AppImage"), "utf8")).resolves.toBe(
      "linux appimage"
    );
    await expect(readFile(join(releaseDir, "Hot-Cross-Buns-2-linux-x64.AppImage"), "utf8")).resolves.toBe(
      "linux appimage"
    );
    if (process.platform !== "win32") {
      expect((await stat(join(releaseDir, "Hot-Cross-Buns-2-linux.AppImage"))).mode & 0o111).not.toBe(0);
      expect((await stat(join(releaseDir, "Hot-Cross-Buns-2-linux-x64.AppImage"))).mode & 0o111).not.toBe(0);
    }
  });

  it("copies only versioned Windows installer artifacts into stable aliases", async () => {
    const releaseDir = await createReleaseDir();

    await writeFile(join(releaseDir, "helper-windows-x64.exe"), "wrong");
    await writeFile(join(releaseDir, "Hot-Cross-Buns-2-windows.exe"), "old stable");
    await writeFile(join(releaseDir, "Hot-Cross-Buns-2-5.0.0-windows-x64.exe"), "windows installer");

    await expect(writeWindowsPreviewArtifacts({ releaseDir })).resolves.toHaveLength(2);
    await expect(readFile(join(releaseDir, "Hot-Cross-Buns-2-windows.exe"), "utf8")).resolves.toBe(
      "windows installer"
    );
    await expect(readFile(join(releaseDir, "Hot-Cross-Buns-2-windows-x64.exe"), "utf8")).resolves.toBe(
      "windows installer"
    );
  });

  it("rejects missing versioned release artifacts", async () => {
    const releaseDir = await createReleaseDir();

    await writeFile(join(releaseDir, "Hot-Cross-Buns-2-linux.AppImage"), "stable only");
    await writeFile(join(releaseDir, "Hot-Cross-Buns-2-windows.exe"), "stable only");

    await expect(writeLinuxPreviewArtifacts({ releaseDir })).rejects.toThrow(
      "No versioned Linux AppImage artifacts found"
    );
    await expect(writeWindowsPreviewArtifacts({ releaseDir })).rejects.toThrow(
      "No versioned Windows installer artifacts found"
    );
  });
});
