import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import packageJson from "../package.json";

const DEFAULT_REPO = "gongahkia/hot-cross-buns";

export type ReleaseAssetTarget = "mac" | "linux" | "windows";

interface ReleaseAsset {
  digest?: string | null;
  name: string;
}

interface ReleaseAssetPreflightInput {
  assets: ReleaseAsset[];
  target: ReleaseAssetTarget;
  version?: string;
}

export interface ReleaseAssetPreflightResult {
  digestProblems: string[];
  matchingUpdateAssets: string[];
  missingAssets: string[];
  ok: boolean;
  requiredAssets: string[];
  target: ReleaseAssetTarget;
}

function argValue(name: string, fallback?: string): string | undefined {
  const prefix = `${name}=`;
  const directIndex = process.argv.indexOf(name);

  if (directIndex >= 0 && process.argv[directIndex + 1]) {
    return process.argv[directIndex + 1];
  }

  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalizeTarget(value: string): ReleaseAssetTarget | "all" {
  if (value === "mac" || value === "linux" || value === "windows" || value === "all") {
    return value;
  }

  throw new Error(`Unsupported release asset target: ${value}`);
}

export function requiredReleaseAssets(target: ReleaseAssetTarget, version = packageJson.version): string[] {
  if (target === "mac") {
    return [
      "Hot-Cross-Buns-macOS.dmg",
      "Hot-Cross-Buns-macOS.dmg.sha256",
      "Hot-Cross-Buns-macOS.zip",
      "Hot-Cross-Buns-macOS.zip.sha256",
      "SHASUMS256.txt",
      `one of Hot-Cross-Buns-${version}-mac-<arch>.dmg`,
      `one of Hot-Cross-Buns-${version}-mac-<arch>.zip`
    ];
  }

  if (target === "linux") {
    return [
      `Hot-Cross-Buns-${version}-linux-x86_64.AppImage`,
      `Hot-Cross-Buns-${version}-linux-x86_64.AppImage.sha256`,
      "Hot-Cross-Buns-linux.AppImage",
      "Hot-Cross-Buns-linux.AppImage.sha256",
      "Hot-Cross-Buns-linux-x64.AppImage",
      "Hot-Cross-Buns-linux-x64.AppImage.sha256",
      "SHASUMS256.txt"
    ];
  }

  return [
    `Hot-Cross-Buns-${version}-windows-x64.exe`,
    `Hot-Cross-Buns-${version}-windows-x64.exe.sha256`,
    "Hot-Cross-Buns-windows.exe",
    "Hot-Cross-Buns-windows.exe.sha256",
    "Hot-Cross-Buns-windows-x64.exe",
    "Hot-Cross-Buns-windows-x64.exe.sha256",
    "SHASUMS256.txt"
  ];
}

export function matchesUpdateCheckAsset(assetName: string, target: ReleaseAssetTarget): boolean {
  if (target === "mac") {
    return /^Hot-Cross-Buns-macOS\.dmg$/i.test(assetName) ||
      /^Hot-Cross-Buns-\d+\.\d+\.\d+-mac-(?:arm64|x64)\.dmg$/i.test(assetName);
  }

  if (target === "linux") {
    return /linux-(?:x64|x86_64)\.AppImage$/i.test(assetName);
  }

  return /windows-(?:x64|x86_64)\.exe$/i.test(assetName);
}

function releaseArtifacts(target: ReleaseAssetTarget, version = packageJson.version): string[] {
  if (target === "mac") {
    return [
      "Hot-Cross-Buns-macOS.dmg",
      "Hot-Cross-Buns-macOS.zip"
    ];
  }

  if (target === "linux") {
    return [
      `Hot-Cross-Buns-${version}-linux-x86_64.AppImage`,
      "Hot-Cross-Buns-linux.AppImage",
      "Hot-Cross-Buns-linux-x64.AppImage"
    ];
  }

  return [
    `Hot-Cross-Buns-${version}-windows-x64.exe`,
    "Hot-Cross-Buns-windows.exe",
    "Hot-Cross-Buns-windows-x64.exe"
  ];
}

function versionedArtifact(target: ReleaseAssetTarget, version = packageJson.version): string {
  if (target === "mac") {
    return `Hot-Cross-Buns-${version}-mac-<arch>.dmg`;
  }

  return target === "linux"
    ? `Hot-Cross-Buns-${version}-linux-x86_64.AppImage`
    : `Hot-Cross-Buns-${version}-windows-x64.exe`;
}

function stableAliases(target: ReleaseAssetTarget): string[] {
  if (target === "mac") {
    return ["Hot-Cross-Buns-macOS.dmg", "Hot-Cross-Buns-macOS.zip"];
  }

  return target === "linux"
    ? ["Hot-Cross-Buns-linux.AppImage", "Hot-Cross-Buns-linux-x64.AppImage"]
    : ["Hot-Cross-Buns-windows.exe", "Hot-Cross-Buns-windows-x64.exe"];
}

function assetDigestProblems(input: ReleaseAssetPreflightInput): string[] {
  const assetsByName = new Map(input.assets.map((asset) => [asset.name, asset]));
  const problems: string[] = [];
  const versioned = versionedArtifact(input.target, input.version);
  const versionedDigest = assetsByName.get(versioned)?.digest;

  for (const artifact of releaseArtifacts(input.target, input.version)) {
    const uploadedAsset = assetsByName.get(artifact);
    const digest = uploadedAsset?.digest;

    if (!uploadedAsset) {
      continue;
    }

    if (!digest) {
      problems.push(`${artifact} is missing a GitHub SHA-256 digest`);
    } else if (!digest.startsWith("sha256:")) {
      problems.push(`${artifact} has unsupported digest metadata: ${digest}`);
    }
  }

  if (!versionedDigest) {
    return problems;
  }

  for (const alias of stableAliases(input.target)) {
    const aliasDigest = assetsByName.get(alias)?.digest;

    if (aliasDigest && aliasDigest !== versionedDigest) {
      problems.push(`${alias} digest does not match ${versioned}`);
    }
  }

  return problems;
}

export function evaluateReleaseAssetPreflight(
  input: ReleaseAssetPreflightInput
): ReleaseAssetPreflightResult {
  const assetNames = new Set(input.assets.map((asset) => asset.name));
  const requiredAssets = requiredReleaseAssets(input.target, input.version);
  const missingAssets = requiredAssets.filter((asset) => {
    if (input.target === "mac" && asset.includes("<arch>")) {
      const extension = asset.endsWith(".zip") ? "zip" : "dmg";
      return !input.assets.some((candidate) =>
        new RegExp(`^Hot-Cross-Buns-${escapeRegExp(input.version ?? packageJson.version)}-mac-(?:arm64|x64)\\.${extension}$`, "i")
          .test(candidate.name)
      );
    }
    return !assetNames.has(asset);
  });
  const matchingUpdateAssets = input.assets
    .map((asset) => asset.name)
    .filter((assetName) => matchesUpdateCheckAsset(assetName, input.target));
  const digestProblems = assetDigestProblems(input);

  return {
    digestProblems,
    matchingUpdateAssets,
    missingAssets,
    ok: missingAssets.length === 0 && matchingUpdateAssets.length > 0 && digestProblems.length === 0,
    requiredAssets,
    target: input.target
  };
}

function releaseAssetsFromGh(input: { repo: string; tag: string }): ReleaseAsset[] {
  const raw = execFileSync(
    "gh",
    ["release", "view", input.tag, "--repo", input.repo, "--json", "assets"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const parsed = JSON.parse(raw) as { assets?: Array<{ digest?: unknown; name?: unknown }> };

  return Array.isArray(parsed.assets)
    ? parsed.assets
      .filter((asset) => typeof asset.name === "string")
      .map((asset) => ({
        digest: typeof asset.digest === "string" ? asset.digest : null,
        name: asset.name as string
      }))
    : [];
}

function printResult(result: ReleaseAssetPreflightResult): void {
  console.log(`${result.target} release asset preflight: ${result.ok ? "pass" : "fail"}`);

  if (result.matchingUpdateAssets.length > 0) {
    console.log(`matching update asset(s): ${result.matchingUpdateAssets.join(", ")}`);
  } else {
    console.log("matching update asset(s): none");
  }

  if (result.missingAssets.length > 0) {
    console.log(`missing required asset(s): ${result.missingAssets.join(", ")}`);
  } else {
    console.log("missing required asset(s): none");
  }

  if (result.digestProblems.length > 0) {
    console.log(`digest problem(s): ${result.digestProblems.join(", ")}`);
  } else {
    console.log("digest problem(s): none");
  }
}

async function main(): Promise<void> {
  const target = normalizeTarget(argValue("--target", "all") ?? "all");
  const tag = argValue("--tag", `v${packageJson.version}`) ?? `v${packageJson.version}`;
  const repo = argValue("--repo", DEFAULT_REPO) ?? DEFAULT_REPO;
  const assets = releaseAssetsFromGh({ repo, tag });
  const targets: ReleaseAssetTarget[] = target === "all" ? ["mac", "linux", "windows"] : [target];
  const results = targets.map((targetName) =>
    evaluateReleaseAssetPreflight({ assets, target: targetName })
  );

  console.log(`Release ${tag} asset names: ${assets.map((asset) => asset.name).join(", ") || "none"}`);
  for (const result of results) {
    printResult(result);
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
