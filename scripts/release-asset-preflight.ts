import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import packageJson from "../package.json";

const DEFAULT_REPO = "gongahkia/hot-cross-buns-2";

export type ReleaseAssetTarget = "linux" | "windows";

interface ReleaseAsset {
  name: string;
}

interface ReleaseAssetPreflightInput {
  assets: ReleaseAsset[];
  target: ReleaseAssetTarget;
  version?: string;
}

export interface ReleaseAssetPreflightResult {
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
  if (value === "linux" || value === "windows" || value === "all") {
    return value;
  }

  throw new Error(`Unsupported release asset target: ${value}`);
}

export function requiredReleaseAssets(target: ReleaseAssetTarget, version = packageJson.version): string[] {
  if (target === "linux") {
    return [
      `Hot-Cross-Buns-2-${version}-linux-x86_64.AppImage`,
      `Hot-Cross-Buns-2-${version}-linux-x86_64.AppImage.sha256`,
      "Hot-Cross-Buns-2-linux.AppImage",
      "Hot-Cross-Buns-2-linux.AppImage.sha256",
      "Hot-Cross-Buns-2-linux-x64.AppImage",
      "Hot-Cross-Buns-2-linux-x64.AppImage.sha256",
      "SHASUMS256.txt"
    ];
  }

  return [
    `Hot-Cross-Buns-2-${version}-windows-x64.exe`,
    `Hot-Cross-Buns-2-${version}-windows-x64.exe.sha256`,
    "Hot-Cross-Buns-2-windows.exe",
    "Hot-Cross-Buns-2-windows.exe.sha256",
    "Hot-Cross-Buns-2-windows-x64.exe",
    "Hot-Cross-Buns-2-windows-x64.exe.sha256",
    "SHASUMS256.txt"
  ];
}

export function matchesUpdateCheckAsset(assetName: string, target: ReleaseAssetTarget): boolean {
  if (target === "linux") {
    return /linux-(?:x64|x86_64)\.AppImage$/i.test(assetName);
  }

  return /windows-(?:x64|x86_64)\.exe$/i.test(assetName);
}

export function evaluateReleaseAssetPreflight(
  input: ReleaseAssetPreflightInput
): ReleaseAssetPreflightResult {
  const assetNames = new Set(input.assets.map((asset) => asset.name));
  const requiredAssets = requiredReleaseAssets(input.target, input.version);
  const missingAssets = requiredAssets.filter((asset) => !assetNames.has(asset));
  const matchingUpdateAssets = input.assets
    .map((asset) => asset.name)
    .filter((assetName) => matchesUpdateCheckAsset(assetName, input.target));

  return {
    matchingUpdateAssets,
    missingAssets,
    ok: missingAssets.length === 0 && matchingUpdateAssets.length > 0,
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
  const parsed = JSON.parse(raw) as { assets?: Array<{ name?: unknown }> };

  return Array.isArray(parsed.assets)
    ? parsed.assets
      .filter((asset) => typeof asset.name === "string")
      .map((asset) => ({ name: asset.name as string }))
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
}

async function main(): Promise<void> {
  const target = normalizeTarget(argValue("--target", "all") ?? "all");
  const tag = argValue("--tag", `v${packageJson.version}`) ?? `v${packageJson.version}`;
  const repo = argValue("--repo", DEFAULT_REPO) ?? DEFAULT_REPO;
  const assets = releaseAssetsFromGh({ repo, tag });
  const targets: ReleaseAssetTarget[] = target === "all" ? ["linux", "windows"] : [target];
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

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
