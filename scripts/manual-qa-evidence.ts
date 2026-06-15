import { execFileSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { arch, hostname, platform as osPlatform, release, type } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json";

const DEFAULT_RELEASE_DIR = "release";
const DEFAULT_OUTPUT_DIR = join("artifacts", "manual-qa");

export type ManualQaTarget = "linux" | "windows";

interface FileEvidence {
  bytes: number | null;
  name: string;
  status: "missing" | "present";
}

interface HostEvidence {
  arch: string;
  cwd: string;
  hostname: string;
  node: string;
  osPlatform: string;
  osRelease: string;
  osType: string;
  pnpm: string;
}

interface ManualQaEvidence {
  files: FileEvidence[];
  generatedAt: string;
  gitSha: string;
  host: HostEvidence;
  releaseDir: string;
  target: ManualQaTarget;
  version: string;
}

export interface ManualQaEvidenceOptions {
  generatedAt?: string;
  gitSha?: string;
  host?: HostEvidence;
  outputFile?: string;
  releaseDir?: string;
  target?: ManualQaTarget;
}

function argValue(name: string, fallback?: string): string | undefined {
  const prefix = `${name}=`;
  const directIndex = process.argv.indexOf(name);

  if (directIndex >= 0 && process.argv[directIndex + 1]) {
    return process.argv[directIndex + 1];
  }

  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

export function normalizeManualQaTarget(value: string): ManualQaTarget {
  if (value === "linux") {
    return "linux";
  }

  if (value === "windows" || value === "win32") {
    return "windows";
  }

  throw new Error(`Unsupported manual QA target: ${value}`);
}

export function requiredReleaseFiles(target: ManualQaTarget, version = packageJson.version): string[] {
  if (target === "linux") {
    const artifacts = [
      `Hot-Cross-Buns-2-${version}-linux-x86_64.AppImage`,
      "Hot-Cross-Buns-2-linux.AppImage",
      "Hot-Cross-Buns-2-linux-x64.AppImage"
    ];

    return ["SHASUMS256.txt", ...artifacts.flatMap((artifact) => [artifact, `${artifact}.sha256`])];
  }

  const artifacts = [
    `Hot-Cross-Buns-2-${version}-windows-x64.exe`,
    "Hot-Cross-Buns-2-windows.exe",
    "Hot-Cross-Buns-2-windows-x64.exe"
  ];

  return ["SHASUMS256.txt", ...artifacts.flatMap((artifact) => [artifact, `${artifact}.sha256`])];
}

function commandOutput(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unavailable";
  }
}

function defaultTarget(): ManualQaTarget {
  return normalizeManualQaTarget(process.platform);
}

function defaultHostEvidence(): HostEvidence {
  return {
    arch: arch(),
    cwd: process.cwd(),
    hostname: hostname(),
    node: process.version,
    osPlatform: osPlatform(),
    osRelease: release(),
    osType: type(),
    pnpm: commandOutput("pnpm", ["--version"])
  };
}

async function fileEvidence(releaseDir: string, name: string): Promise<FileEvidence> {
  const filePath = join(releaseDir, name);

  try {
    const stats = await stat(filePath);

    if (!stats.isFile()) {
      return { bytes: null, name, status: "missing" };
    }

    return { bytes: stats.size, name, status: "present" };
  } catch {
    return { bytes: null, name, status: "missing" };
  }
}

function manualChecks(target: ManualQaTarget): string[] {
  if (target === "linux") {
    return [
      "Ubuntu LTS GNOME version and session type recorded",
      "AppImage terminal launch stdout/stderr and exit behavior recorded",
      "AppImage file-manager launch recorded",
      "icon, window title, and taskbar/window grouping verified",
      "isolated HCB_USER_DATA_DIR launch verified",
      "Google OAuth browser round trip completed",
      "Secret Service ready, locked, and missing states verified",
      "packaged AppImage MCP localhost smoke verified",
      "Settings diagnostics paths, adapter id, package format, credential state, and redaction verified",
      "notifications and global shortcuts confirmed explicitly unsupported",
      "tray/status-area, protocol, autostart, and in-place update support claims unchanged or separately verified",
      "Settings update-check verified only after Linux release assets exist"
    ];
  }

  return [
    "NSIS installer run on Windows 11 x64",
    "launch from installer finish, Start Menu, and desktop shortcut verified",
    "AppUserModelID, icon, Start Menu identity, and taskbar grouping verified",
    "SQLite native module and planner CRUD verified",
    "Google OAuth browser round trip and Defender/firewall prompts recorded",
    "Windows safeStorage OAuth persistence verified after restart",
    "installed-app MCP localhost smoke verified",
    "tray menu show/hide, quick capture, refresh, settings, and quit verified",
    "global shortcut success and conflict handling verified",
    "notifications display and click-through verified",
    "hotcrossbuns:// warm-start and cold-start deep links verified",
    "open-at-login enable/disable persistence verified",
    "Settings update-check verified only after Windows release assets exist",
    "interactive uninstall cleanup and retained user-data paths documented"
  ];
}

function markdownTable(rows: readonly [string, string][]): string {
  return ["| Field | Value |", "| --- | --- |", ...rows.map(([field, value]) => `| ${field} | ${value} |`)].join("\n");
}

export function formatManualQaEvidence(evidence: ManualQaEvidence): string {
  const missingFiles = evidence.files.filter((file) => file.status === "missing");
  const targetName = evidence.target === "linux" ? "Linux AppImage" : "Windows NSIS";
  const hostRows: [string, string][] = [
    ["generated at", evidence.generatedAt],
    ["git sha", evidence.gitSha],
    ["package version", evidence.version],
    ["release dir", evidence.releaseDir],
    ["cwd", evidence.host.cwd],
    ["hostname", evidence.host.hostname],
    ["os type", evidence.host.osType],
    ["os platform", evidence.host.osPlatform],
    ["os release", evidence.host.osRelease],
    ["arch", evidence.host.arch],
    ["node", evidence.host.node],
    ["pnpm", evidence.host.pnpm]
  ];
  const fileRows = evidence.files.map(
    (file) =>
      `| ${file.name} | ${file.status} | ${file.bytes === null ? "" : String(file.bytes)} |`
  );
  const checks = manualChecks(evidence.target).map((check) => `- [ ] ${check}`);

  return [
    `# ${targetName} Manual QA Evidence`,
    "",
    markdownTable(hostRows),
    "",
    "## Release Files",
    "",
    "| File | Status | Bytes |",
    "| --- | --- | --- |",
    ...fileRows,
    "",
    "## Required Manual Evidence",
    "",
    ...checks,
    "",
    "## Result",
    "",
    "- [ ] pass",
    "- [ ] fail",
    "- notes:",
    "",
    missingFiles.length === 0
      ? "Release file preflight: pass."
      : `Release file preflight: fail, ${missingFiles.length} missing file(s).`,
    ""
  ].join("\n");
}

export async function writeManualQaEvidence(options: ManualQaEvidenceOptions = {}): Promise<{
  missingFiles: FileEvidence[];
  outputFile: string;
}> {
  const target = options.target ?? defaultTarget();
  const releaseDir = resolve(options.releaseDir ?? DEFAULT_RELEASE_DIR);
  const outputFile = resolve(options.outputFile ?? join(DEFAULT_OUTPUT_DIR, `${target}-evidence.md`));
  const files = await Promise.all(
    requiredReleaseFiles(target).map((name) => fileEvidence(releaseDir, name))
  );
  const evidence: ManualQaEvidence = {
    files,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    gitSha: options.gitSha ?? commandOutput("git", ["rev-parse", "HEAD"]),
    host: options.host ?? defaultHostEvidence(),
    releaseDir,
    target,
    version: packageJson.version
  };

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, formatManualQaEvidence(evidence), "utf8");

  return {
    missingFiles: files.filter((file) => file.status === "missing"),
    outputFile
  };
}

async function main(): Promise<void> {
  const targetArg = argValue("--target");
  const result = await writeManualQaEvidence({
    outputFile: argValue("--out"),
    releaseDir: argValue("--dir", DEFAULT_RELEASE_DIR),
    target: targetArg ? normalizeManualQaTarget(targetArg) : undefined
  });
  const relativeOutput = resolve(result.outputFile);

  console.log(`Wrote ${relativeOutput}`);

  if (result.missingFiles.length > 0) {
    console.error(
      `Missing release file(s): ${result.missingFiles.map((file) => basename(file.name)).join(", ")}`
    );
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
