import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

const DEFAULT_RELEASE_DIR = "release";
const DEFAULT_OUTPUT_FILE = "SHASUMS256.txt";
const ARTIFACT_EXTENSIONS = new Set([
  ".AppImage",
  ".deb",
  ".dmg",
  ".exe",
  ".msi",
  ".pkg",
  ".rpm",
  ".zip"
]);

interface ChecksumEntry {
  filePath: string;
  relativePath: string;
  sha256: string;
}

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

function isReleaseArtifact(filePath: string): boolean {
  const name = basename(filePath);

  if (
    name.endsWith(".blockmap") ||
    name.endsWith(".yml") ||
    name.endsWith(".sha256") ||
    name === DEFAULT_OUTPUT_FILE
  ) {
    return false;
  }

  return ARTIFACT_EXTENSIONS.has(extname(filePath));
}

async function listArtifacts(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const filePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return listArtifacts(filePath);
      }

      return isReleaseArtifact(filePath) ? [filePath] : [];
    })
  );

  return results.flat().sort((left, right) => left.localeCompare(right));
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);

    input.on("error", rejectHash);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function checksumArtifacts(releaseDir: string): Promise<ChecksumEntry[]> {
  const artifactPaths = await listArtifacts(releaseDir);

  if (artifactPaths.length === 0) {
    throw new Error(`No release artifacts found in ${releaseDir}`);
  }

  return Promise.all(
    artifactPaths.map(async (filePath) => ({
      filePath,
      relativePath: relative(releaseDir, filePath),
      sha256: await sha256File(filePath)
    }))
  );
}

async function main(): Promise<void> {
  const releaseDir = resolve(argValue("--dir", DEFAULT_RELEASE_DIR));
  const outputFile = resolve(releaseDir, argValue("--out", DEFAULT_OUTPUT_FILE));
  const directoryStats = await stat(releaseDir);

  if (!directoryStats.isDirectory()) {
    throw new Error(`${releaseDir} is not a directory`);
  }

  const checksums = await checksumArtifacts(releaseDir);
  const body = `${checksums
    .map((entry) => `${entry.sha256}  ${entry.relativePath}`)
    .join("\n")}\n`;

  await writeFile(outputFile, body, "utf8");
  await Promise.all(
    checksums.map((entry) =>
      writeFile(`${entry.filePath}.sha256`, `${entry.sha256}  ${basename(entry.filePath)}\n`, "utf8")
    )
  );

  console.log(`Wrote ${checksums.length} checksum(s) to ${outputFile}`);
  for (const entry of checksums) {
    console.log(`${entry.sha256}  ${entry.relativePath}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
