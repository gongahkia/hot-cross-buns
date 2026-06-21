import { copyFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_RELEASE_DIR = "release";
const STABLE_PREFIX = "Hot-Cross-Buns-windows";
const windowsInstallerPattern = /^Hot-Cross-Buns-\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?-windows-(x64|x86_64|arm64|aarch64)\.exe$/;

interface PreviewArtifactOptions {
  releaseDir?: string;
}

interface CandidateArtifact {
  arch: "arm64" | "x64";
  filePath: string;
  mtimeMs: number;
  name: string;
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

export async function writeWindowsPreviewArtifacts(
  options: PreviewArtifactOptions = {}
): Promise<string[]> {
  const releaseDir = resolve(options.releaseDir ?? DEFAULT_RELEASE_DIR);
  const latest = await findLatestWindowsInstaller(releaseDir);
  const stablePath = join(releaseDir, `${STABLE_PREFIX}.exe`);
  const archPath = join(releaseDir, `${STABLE_PREFIX}-${latest.arch}.exe`);
  const messages: string[] = [];

  await copyFile(latest.filePath, stablePath);
  messages.push(`Wrote ${stablePath} from ${latest.name}`);
  await copyFile(latest.filePath, archPath);
  messages.push(`Wrote ${archPath} from ${latest.name}`);

  return messages;
}

async function findLatestWindowsInstaller(releaseDir: string): Promise<CandidateArtifact> {
  const entries = await readdir(releaseDir);
  const candidates = (
    await Promise.all(
      entries.map(async (entry) => {
        const filePath = join(releaseDir, entry);
        const stats = await stat(filePath);
        const match = windowsInstallerPattern.exec(basename(entry));

        if (!stats.isFile() || extname(entry) !== ".exe" || !match) {
          return null;
        }

        return {
          arch: normalizeArch(match[1]),
          filePath,
          mtimeMs: stats.mtimeMs,
          name: entry
        };
      })
    )
  ).filter((entry): entry is CandidateArtifact => entry !== null);
  const latest = candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];

  if (!latest) {
    throw new Error(`No versioned Windows installer artifacts found in ${releaseDir}`);
  }

  return latest;
}

function normalizeArch(value: string): CandidateArtifact["arch"] {
  return value === "arm64" || value === "aarch64" ? "arm64" : "x64";
}

async function main(): Promise<void> {
  const messages = await writeWindowsPreviewArtifacts({
    releaseDir: argValue("--dir", DEFAULT_RELEASE_DIR)
  });

  for (const message of messages) {
    console.log(message);
  }
}

const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
