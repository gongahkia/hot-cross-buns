import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_RELEASE_DIR = "release";
const stableInstallerName = "Hot-Cross-Buns-2-windows.exe";
const stableX64InstallerName = "Hot-Cross-Buns-2-windows-x64.exe";
const checksumManifestName = "SHASUMS256.txt";
const minimumInstallerBytes = 20 * 1024 * 1024;
const versionedInstallerPattern = /^Hot-Cross-Buns-2-\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?-windows-x64\.exe$/;

interface SmokeOptions {
  artifact?: string;
  minimumBytes?: number;
  releaseDir?: string;
}

interface ChecksumEntry {
  hash: string;
  path: string;
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

export async function smokeWindowsNsisArtifact(options: SmokeOptions = {}): Promise<string[]> {
  const releaseDir = resolve(options.releaseDir ?? DEFAULT_RELEASE_DIR);
  const minimumBytes = options.minimumBytes ?? minimumInstallerBytes;
  const requestedArtifact = options.artifact ? resolve(options.artifact) : undefined;
  const versionedInstaller = requestedArtifact ?? await findVersionedInstaller(releaseDir);
  const requiredArtifacts = uniquePaths([
    versionedInstaller,
    join(releaseDir, stableInstallerName),
    join(releaseDir, stableX64InstallerName)
  ]);
  const manifestPath = join(releaseDir, checksumManifestName);
  const manifestEntries = parseChecksumManifest(await readFile(manifestPath, "utf8"));
  const artifactHashes = new Map<string, string>();
  const messages: string[] = [];

  verifyManifestContainsOnlyTopLevelArtifacts(manifestEntries);

  for (const artifact of requiredArtifacts) {
    const stats = await stat(artifact);

    if (!stats.isFile()) {
      throw new Error(`${artifact} is not a file`);
    }

    if (stats.size < minimumBytes) {
      throw new Error(`${basename(artifact)} is unexpectedly small for a Windows NSIS installer.`);
    }

    const hash = await sha256File(artifact);
    const relativePath = normalizedPath(relative(releaseDir, artifact));
    const manifestEntry = manifestEntries.find((entry) => normalizedPath(entry.path) === relativePath);

    if (!manifestEntry) {
      throw new Error(`${checksumManifestName} is missing ${relativePath}`);
    }

    if (manifestEntry.hash !== hash) {
      throw new Error(`${checksumManifestName} hash does not match ${relativePath}`);
    }

    const sidecarPath = `${artifact}.sha256`;
    const sidecar = parseChecksumLine((await readFile(sidecarPath, "utf8")).trim(), sidecarPath);

    if (sidecar.hash !== hash || sidecar.path !== basename(artifact)) {
      throw new Error(`${basename(sidecarPath)} does not match ${basename(artifact)}`);
    }

    artifactHashes.set(resolve(artifact), hash);
    messages.push(`${basename(artifact)} exists, is ${stats.size} bytes, and has matching SHA-256 metadata.`);
  }

  verifyStableAliasMatchesVersionedArtifact(artifactHashes, versionedInstaller, join(releaseDir, stableInstallerName));
  verifyStableAliasMatchesVersionedArtifact(artifactHashes, versionedInstaller, join(releaseDir, stableX64InstallerName));

  return messages;
}

async function findVersionedInstaller(releaseDir: string): Promise<string> {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const candidates = (
    await Promise.all(
      entries.map(async (entry) => {
        const filePath = join(releaseDir, entry.name);

        if (!entry.isFile() || extname(entry.name) !== ".exe" || !versionedInstallerPattern.test(entry.name)) {
          return null;
        }

        return {
          filePath,
          mtimeMs: (await stat(filePath)).mtimeMs
        };
      })
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const latest = candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];

  if (!latest) {
    throw new Error(`No versioned Windows x64 installer artifact found in ${releaseDir}`);
  }

  return latest.filePath;
}

function parseChecksumManifest(source: string): ChecksumEntry[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseChecksumLine(line, checksumManifestName));
}

function parseChecksumLine(line: string, sourceName: string): ChecksumEntry {
  const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);

  if (!match) {
    throw new Error(`${sourceName} has invalid SHA-256 metadata.`);
  }

  return {
    hash: match[1].toLowerCase(),
    path: match[2].trim()
  };
}

function verifyManifestContainsOnlyTopLevelArtifacts(entries: ChecksumEntry[]): void {
  const nestedEntry = entries.find((entry) => normalizedPath(entry.path).includes("/"));

  if (nestedEntry) {
    throw new Error(`${checksumManifestName} contains nested artifact ${nestedEntry.path}; regenerate release checksums.`);
  }
}

function verifyStableAliasMatchesVersionedArtifact(hashes: Map<string, string>, versionedArtifact: string, aliasArtifact: string): void {
  const versionedHash = hashes.get(resolve(versionedArtifact));
  const aliasHash = hashes.get(resolve(aliasArtifact));

  if (!versionedHash || !aliasHash || versionedHash !== aliasHash) {
    throw new Error(`${basename(aliasArtifact)} does not match ${basename(versionedArtifact)}; regenerate Windows stable aliases.`);
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
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

async function main(): Promise<void> {
  const releaseDir = resolve(process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : argValue("--dir", DEFAULT_RELEASE_DIR));
  const artifact = argValue("--artifact", "");
  const minimumBytes = Number.parseInt(argValue("--min-bytes", String(minimumInstallerBytes)), 10);
  const messages = await smokeWindowsNsisArtifact({
    releaseDir,
    ...(artifact ? { artifact } : {}),
    minimumBytes: Number.isFinite(minimumBytes) ? minimumBytes : minimumInstallerBytes
  });

  for (const message of messages) {
    console.log(message);
  }

  console.log("Windows install, launch, protocol, notification, and uninstall behavior still require Windows manual QA.");
}

const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
