import { copyFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const DEFAULT_RELEASE_DIR = "release";
const STABLE_PREFIX = "Hot-Cross-Buns-2-macOS";
const artifactExtensions = new Set([".dmg", ".zip"]);

function argValue(name: string, fallback: string): string {
  const prefix = `${name}=`;
  const directIndex = process.argv.indexOf(name);

  if (directIndex >= 0 && process.argv[directIndex + 1]) {
    return process.argv[directIndex + 1];
  }

  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length) ?? fallback;
}

async function main(): Promise<void> {
  const releaseDir = resolve(argValue("--dir", DEFAULT_RELEASE_DIR));
  const entries = await readdir(releaseDir);
  const artifacts = (
    await Promise.all(
      entries.map(async (entry) => {
        const filePath = join(releaseDir, entry);
        const stats = await stat(filePath);

        if (!stats.isFile() || !artifactExtensions.has(extname(entry))) {
          return null;
        }

        if (basename(entry).startsWith(STABLE_PREFIX)) {
          return null;
        }

        return {
          filePath,
          name: entry,
          extension: extname(entry),
          mtimeMs: stats.mtimeMs
        };
      })
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  for (const extension of artifactExtensions) {
    const candidates = artifacts
      .filter((artifact) => artifact.extension === extension)
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    const latest = candidates[0];

    if (!latest) {
      continue;
    }

    const arch = latest.name.includes("arm64")
      ? "arm64"
      : latest.name.includes("x64")
      ? "x64"
      : null;
    const stablePath = join(releaseDir, `${STABLE_PREFIX}${extension}`);

    await copyFile(latest.filePath, stablePath);
    console.log(`Wrote ${stablePath} from ${latest.name}`);

    if (arch) {
      const archPath = join(releaseDir, `${STABLE_PREFIX}-${arch}${extension}`);
      await copyFile(latest.filePath, archPath);
      console.log(`Wrote ${archPath} from ${latest.name}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
