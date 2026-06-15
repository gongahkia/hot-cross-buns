import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json";
import { verifyManualQaEvidenceTemplate } from "./manual-qa-evidence";

const DEFAULT_BUNDLE_DIR = ".";
const checksumManifestName = "SHASUMS256.txt";

export type PreviewArtifactBundleTarget = "linux" | "windows";

interface ChecksumEntry {
  hash: string;
  path: string;
}

interface BundleVerificationOptions {
  bundleDir?: string;
  target: PreviewArtifactBundleTarget;
  version?: string;
}

interface BundleLayout {
  evidencePath: string;
  perfJsonPath: string;
  perfMarkdownPath: string;
  releaseDir: string;
  reviewJsonPath: string;
  reviewMarkdownPath: string;
}

function argValue(name: string, fallback?: string): string | undefined {
  const prefix = `${name}=`;
  const directIndex = process.argv.indexOf(name);

  if (directIndex >= 0 && process.argv[directIndex + 1]) {
    return process.argv[directIndex + 1];
  }

  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalizeTarget(value: string | undefined): PreviewArtifactBundleTarget {
  if (value === "linux" || value === "windows") {
    return value;
  }

  throw new Error(`Unsupported preview artifact bundle target: ${value ?? "missing"}`);
}

function expectedReleaseArtifacts(
  target: PreviewArtifactBundleTarget,
  version = packageJson.version
): string[] {
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

function bundleLayout(bundleDir: string, target: PreviewArtifactBundleTarget): BundleLayout {
  const root = resolve(bundleDir);

  return {
    evidencePath: join(root, "artifacts", "manual-qa", `${target}-evidence.md`),
    perfJsonPath: join(root, "artifacts", "perf", "latest.json"),
    perfMarkdownPath: join(root, "artifacts", "perf", "latest.md"),
    releaseDir: join(root, "release"),
    reviewJsonPath: join(root, "artifacts", "release", "bundle-review.json"),
    reviewMarkdownPath: join(root, "artifacts", "release", "bundle-review.md")
  };
}

async function assertFile(filePath: string): Promise<number> {
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

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function verifyStableAliasesMatch(
  hashes: Map<string, string>,
  target: PreviewArtifactBundleTarget,
  version = packageJson.version
): void {
  const versioned = target === "linux"
    ? `Hot-Cross-Buns-2-${version}-linux-x86_64.AppImage`
    : `Hot-Cross-Buns-2-${version}-windows-x64.exe`;
  const aliases = target === "linux"
    ? ["Hot-Cross-Buns-2-linux.AppImage", "Hot-Cross-Buns-2-linux-x64.AppImage"]
    : ["Hot-Cross-Buns-2-windows.exe", "Hot-Cross-Buns-2-windows-x64.exe"];
  const versionedHash = hashes.get(versioned);

  if (!versionedHash) {
    throw new Error(`${versioned} was not hashed`);
  }

  for (const alias of aliases) {
    if (hashes.get(alias) !== versionedHash) {
      throw new Error(`${alias} does not match ${versioned}`);
    }
  }
}

async function verifyReleaseArtifacts(
  layout: BundleLayout,
  target: PreviewArtifactBundleTarget,
  version = packageJson.version
): Promise<string[]> {
  const messages: string[] = [];
  const manifestPath = join(layout.releaseDir, checksumManifestName);
  const manifestEntries = parseChecksumManifest(await readFile(manifestPath, "utf8"));
  const manifestPaths = new Set(manifestEntries.map((entry) => normalizedPath(entry.path)));
  const hashes = new Map<string, string>();

  for (const artifact of expectedReleaseArtifacts(target, version)) {
    const artifactPath = join(layout.releaseDir, artifact);
    const artifactSize = await assertFile(artifactPath);
    const artifactHash = await sha256File(artifactPath);
    const manifestEntry = manifestEntries.find((entry) => normalizedPath(entry.path) === artifact);

    if (!manifestEntry) {
      throw new Error(`${checksumManifestName} is missing ${artifact}`);
    }

    if (manifestEntry.hash !== artifactHash) {
      throw new Error(`${checksumManifestName} hash does not match ${artifact}`);
    }

    const sidecarPath = `${artifactPath}.sha256`;
    const sidecar = parseChecksumLine((await readFile(sidecarPath, "utf8")).trim(), basename(sidecarPath));

    if (sidecar.hash !== artifactHash || sidecar.path !== artifact) {
      throw new Error(`${basename(sidecarPath)} does not match ${artifact}`);
    }

    hashes.set(artifact, artifactHash);
    messages.push(`${artifact} exists, is ${artifactSize} bytes, and has matching SHA-256 metadata.`);
  }

  for (const artifact of expectedReleaseArtifacts(target, version)) {
    if (!manifestPaths.has(artifact)) {
      throw new Error(`${checksumManifestName} is missing ${artifact}`);
    }
  }

  verifyStableAliasesMatch(hashes, target, version);

  return messages;
}

async function verifyEvidenceTemplate(
  evidencePath: string,
  target: PreviewArtifactBundleTarget
): Promise<string> {
  const evidence = await readFile(evidencePath, "utf8");

  try {
    verifyManualQaEvidenceTemplate(evidence, target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`${relative(process.cwd(), evidencePath)} failed template verification: ${message}`);
  }

  return `${relative(process.cwd(), evidencePath)} exists and contains the current manual QA evidence template.`;
}

async function verifySupportArtifacts(layout: BundleLayout): Promise<string[]> {
  const files = [
    layout.reviewJsonPath,
    layout.reviewMarkdownPath,
    layout.perfJsonPath,
    layout.perfMarkdownPath
  ];
  const messages: string[] = [];

  for (const file of files) {
    const size = await assertFile(file);
    messages.push(`${relative(process.cwd(), file)} exists and is ${size} bytes.`);
  }

  return messages;
}

export async function verifyPreviewArtifactBundle(
  options: BundleVerificationOptions
): Promise<string[]> {
  const bundleDir = resolve(options.bundleDir ?? DEFAULT_BUNDLE_DIR);
  const layout = bundleLayout(bundleDir, options.target);
  const releaseMessages = await verifyReleaseArtifacts(layout, options.target, options.version);
  const evidenceMessage = await verifyEvidenceTemplate(layout.evidencePath, options.target);
  const supportMessages = await verifySupportArtifacts(layout);
  const messages = [...releaseMessages, evidenceMessage, ...supportMessages];
  const releaseEntries = await readdir(layout.releaseDir);

  messages.push(`release directory contains ${releaseEntries.length} item(s).`);

  return messages;
}

async function main(): Promise<void> {
  const target = normalizeTarget(argValue("--target"));
  const bundleDir = argValue("--dir", DEFAULT_BUNDLE_DIR);
  const messages = await verifyPreviewArtifactBundle({ bundleDir, target });

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
