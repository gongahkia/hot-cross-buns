import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReleaseChecksums } from "./release-checksums";

async function createReleaseDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hcb-checksums-"));
}

describe("release checksum generation", () => {
  it("writes checksums only for top-level uploadable release artifacts", async () => {
    const releaseDir = await createReleaseDir();
    const unpackedDir = join(releaseDir, "win-unpacked", "resources");

    await mkdir(unpackedDir, { recursive: true });
    await writeFile(join(releaseDir, "Hot-Cross-Buns-windows-x64.exe"), "installer");
    await writeFile(join(releaseDir, "Hot-Cross-Buns-windows-x64.exe.blockmap"), "blockmap");
    await writeFile(join(releaseDir, "latest.yml"), "latest");
    await writeFile(join(unpackedDir, "elevate.exe"), "helper");

    const checksums = await writeReleaseChecksums({ releaseDir });
    const manifest = await readFile(join(releaseDir, "SHASUMS256.txt"), "utf8");

    expect(checksums.map((entry) => entry.relativePath)).toEqual(["Hot-Cross-Buns-windows-x64.exe"]);
    expect(manifest).toContain("  Hot-Cross-Buns-windows-x64.exe\n");
    expect(manifest).not.toContain("win-unpacked");
    await expect(stat(join(releaseDir, "Hot-Cross-Buns-windows-x64.exe.sha256"))).resolves.toMatchObject({
      size: expect.any(Number)
    });
    await expect(stat(join(unpackedDir, "elevate.exe.sha256"))).rejects.toThrow();
  });
});
