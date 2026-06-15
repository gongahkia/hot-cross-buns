import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json";
import { verifyManualQaEvidence } from "./manual-qa-evidence";
import { requiredReleaseAssets, type ReleaseAssetTarget } from "./release-asset-preflight";

const checksumManifestName = "SHASUMS256.txt";

interface ChecksumEntry {
  hash: string;
  path: string;
}

interface ReleaseUploadPreflightOptions {
  evidenceFile?: string;
  releaseDir?: string;
  target: ReleaseAssetTarget;
  version?: string;
}

function argValue(name: string, fallback?: string): string | undefined {
  const prefix = `${name}=`;
  const directIndex = process.argv.indexOf(name);

  if (directIndex >= 0 && process.argv[directIndex + 1]) {
    return process.argv[directIndex + 1];
  }

  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalizeTarget(value: string | undefined): ReleaseAssetTarget {
  if (value === "linux" || value === "windows") {
    return value;
  }

  throw new Error(`Unsupported release upload preflight target: ${value ?? "missing"}`);
}

function releaseArtifacts(target: ReleaseAssetTarget, version = packageJson.version): string[] {
  if (target === "linux") {
    return [
      `Hot-Cross-Buns-2-${version}-linux-x86_64.AppImage`,
      "Hot-Cross-Buns-2-linux.AppImage",
      "Hot-Cross-Buns-2-linux-x64.AppImage"
    ];
  }

  return [
    `Hot-Cross-Buns-2-${version}-windows-x64.exe`,
    "Hot-Cross-Buns-2-windows.exe",
    "Hot-Cross-Buns-2-windows-x64.exe"
  ];
}

function versionedArtifact(target: ReleaseAssetTarget, version = packageJson.version): string {
  return target === "linux"
    ? `Hot-Cross-Buns-2-${version}-linux-x86_64.AppImage`
    : `Hot-Cross-Buns-2-${version}-windows-x64.exe`;
}

function stableAliases(target: ReleaseAssetTarget): string[] {
  return target === "linux"
    ? ["Hot-Cross-Buns-2-linux.AppImage", "Hot-Cross-Buns-2-linux-x64.AppImage"]
    : ["Hot-Cross-Buns-2-windows.exe", "Hot-Cross-Buns-2-windows-x64.exe"];
}

function parseChecksumLine(line: string, sourceName: string): ChecksumEntry {
  const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());

  if (!match) {
    throw new Error(`${sourceName} has invalid SHA-256 metadata.`);
  }

  return {
    hash: match[1].toLowerCase(),
    path: match[2].trim().replace(/\\/g, "/")
  };
}

function parseChecksumManifest(source: string): ChecksumEntry[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseChecksumLine(line, checksumManifestName));
}

async function assertNonEmptyFile(filePath: string): Promise<number> {
  const stats = await stat(filePath);

  if (!stats.isFile()) {
    throw new Error(`${filePath} is not a file`);
  }

  if (stats.size <= 0) {
    throw new Error(`${filePath} is empty`);
  }

  return stats.size;
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

function defaultEvidenceFile(target: ReleaseAssetTarget): string {
  return join("artifacts", "manual-qa", `${target}-evidence.md`);
}

async function verifyReleaseFiles(
  options: Required<Pick<ReleaseUploadPreflightOptions, "releaseDir" | "target" | "version">>
): Promise<string[]> {
  const releaseDir = resolve(options.releaseDir);
  const manifestPath = join(releaseDir, checksumManifestName);
  const manifestEntries = parseChecksumManifest(await readFile(manifestPath, "utf8"));
  const manifestByPath = new Map(manifestEntries.map((entry) => [entry.path, entry.hash]));
  const hashes = new Map<string, string>();
  const messages: string[] = [];

  for (const asset of requiredReleaseAssets(options.target, options.version)) {
    await assertNonEmptyFile(join(releaseDir, asset));
  }

  for (const artifact of releaseArtifacts(options.target, options.version)) {
    const artifactPath = join(releaseDir, artifact);
    const artifactSize = await assertNonEmptyFile(artifactPath);
    const artifactHash = await sha256File(artifactPath);
    const manifestHash = manifestByPath.get(artifact);

    if (!manifestHash) {
      throw new Error(`${checksumManifestName} is missing ${artifact}`);
    }

    if (manifestHash !== artifactHash) {
      throw new Error(`${checksumManifestName} hash does not match ${artifact}`);
    }

    const sidecarPath = `${artifactPath}.sha256`;
    const sidecar = parseChecksumLine(await readFile(sidecarPath, "utf8"), basename(sidecarPath));

    if (sidecar.hash !== artifactHash || sidecar.path !== artifact) {
      throw new Error(`${basename(sidecarPath)} does not match ${artifact}`);
    }

    hashes.set(artifact, artifactHash);
    messages.push(`${artifact} exists, is ${artifactSize} bytes, and has matching SHA-256 metadata.`);
  }

  const versionedHash = hashes.get(versionedArtifact(options.target, options.version));

  if (!versionedHash) {
    throw new Error(`${versionedArtifact(options.target, options.version)} was not hashed`);
  }

  for (const alias of stableAliases(options.target)) {
    if (hashes.get(alias) !== versionedHash) {
      throw new Error(`${alias} does not match ${versionedArtifact(options.target, options.version)}`);
    }
  }

  return messages;
}

export async function verifyReleaseUploadPreflight(options: ReleaseUploadPreflightOptions): Promise<string[]> {
  const target = options.target;
  const releaseDir = options.releaseDir ?? "release";
  const version = options.version ?? packageJson.version;
  const evidenceFile = options.evidenceFile ?? defaultEvidenceFile(target);
  const releaseMessages = await verifyReleaseFiles({ releaseDir, target, version });
  const evidenceMessages = await verifyManualQaEvidence({
    evidenceFile,
    target
  });

  return [
    ...releaseMessages,
    ...evidenceMessages,
    `${target} release upload preflight passed for ${version}.`
  ];
}

async function main(): Promise<void> {
  const target = normalizeTarget(argValue("--target"));
  const messages = await verifyReleaseUploadPreflight({
    evidenceFile: argValue("--evidence"),
    releaseDir: argValue("--release-dir", "release"),
    target,
    version: argValue("--version", packageJson.version)
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
