import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { arch, hostname, platform as osPlatform, release, type } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json";

const DEFAULT_RELEASE_DIR = "release";
const DEFAULT_OUTPUT_DIR = join("artifacts", "manual-qa");

export type ManualQaTarget = "linux" | "windows";
export type ManualQaVerificationStage = "full" | "pre-upload";

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

export interface VerifyManualQaEvidenceOptions {
  evidenceFile: string;
  stage?: ManualQaVerificationStage;
  target: ManualQaTarget;
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

function normalizeVerificationStage(value: string | undefined): ManualQaVerificationStage {
  if (!value || value === "full") {
    return "full";
  }

  if (value === "pre-upload") {
    return "pre-upload";
  }

  throw new Error(`Unsupported manual QA verification stage: ${value}`);
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

function preUploadManualChecks(target: ManualQaTarget): string[] {
  if (target === "linux") {
    return [
      "Ubuntu 26.04 LTS GNOME version and session type recorded",
      "AppImage terminal launch stdout/stderr and exit behavior recorded",
      "AppImage file-manager launch recorded",
      "icon, window title, and taskbar/window grouping verified",
      "isolated HCB_USER_DATA_DIR launch verified",
      "Google OAuth browser round trip completed",
      "Secret Service ready, locked, and missing states verified",
      "packaged AppImage MCP localhost smoke verified",
      "Settings diagnostics paths, adapter id, package format, credential state, and redaction verified",
      "notifications and global shortcuts confirmed explicitly unsupported",
      "tray/status-area, protocol, autostart, and in-place update support claims unchanged or separately verified"
    ];
  }

  return [
    "NSIS installer run on Windows 11 25H2 x64",
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
    "interactive uninstall cleanup and retained user-data paths documented"
  ];
}

function postUploadManualChecks(target: ManualQaTarget): string[] {
  return target === "linux"
    ? ["Settings update-check verified only after Linux release assets exist"]
    : ["Settings update-check verified only after Windows release assets exist"];
}

function targetHostDetailFields(target: ManualQaTarget): string[] {
  return target === "linux"
    ? ["target os", "desktop", "session", "tester", "evidence attachments"]
    : ["target windows version", "os build", "arch", "tester", "evidence attachments"];
}

function targetHostDetailValue(source: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^- ${escaped}:[ \t]*(.+)$`, "im").exec(source);

  return match?.[1].trim() ?? "";
}

function verifyTargetHostDetails(source: string, target: ManualQaTarget): void {
  for (const field of targetHostDetailFields(target)) {
    if (!targetHostDetailValue(source, field)) {
      throw new Error(`Manual QA evidence is missing target-host detail: ${field}`);
    }
  }

  if (target === "linux") {
    const os = targetHostDetailValue(source, "target os");
    const desktop = targetHostDetailValue(source, "desktop");

    if (!/Ubuntu\s+26\.04\s+LTS/i.test(os)) {
      throw new Error("Manual QA evidence target os is not Ubuntu 26.04 LTS");
    }

    if (!/GNOME/i.test(desktop)) {
      throw new Error("Manual QA evidence desktop is not GNOME");
    }

    return;
  }

  const version = targetHostDetailValue(source, "target windows version");
  const arch = targetHostDetailValue(source, "arch");

  if (!/Windows\s+11/i.test(version) || !/25H2/i.test(version)) {
    throw new Error("Manual QA evidence target windows version is not Windows 11 25H2");
  }

  if (!/x64|amd64/i.test(arch)) {
    throw new Error("Manual QA evidence architecture is not x64");
  }
}

function manualChecks(target: ManualQaTarget, stage: ManualQaVerificationStage = "full"): string[] {
  const preUploadChecks = preUploadManualChecks(target);

  return stage === "pre-upload"
    ? preUploadChecks
    : [...preUploadChecks, ...postUploadManualChecks(target)];
}

function targetTitle(target: ManualQaTarget): string {
  return target === "linux" ? "# Linux AppImage Manual QA Evidence" : "# Windows NSIS Manual QA Evidence";
}

function expectedOsPlatform(target: ManualQaTarget): string {
  return target === "linux" ? "linux" : "win32";
}

function section(source: string, heading: string): string {
  const marker = `## ${heading}\n`;
  const start = source.indexOf(marker);

  if (start < 0) {
    throw new Error(`Manual QA evidence is missing section: ${heading}`);
  }

  const contentStart = start + marker.length;
  const next = source.indexOf("\n## ", contentStart);

  return next < 0 ? source.slice(contentStart) : source.slice(contentStart, next);
}

function checkedLine(source: string, text: string): boolean {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`^- \\[x\\] ${escaped}$`, "m").test(source);
}

function uncheckedLine(source: string, text: string): boolean {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`^- \\[ \\] ${escaped}$`, "m").test(source);
}

function resultNotes(source: string): string {
  const lines = source.split(/\r?\n/);
  const notesIndex = lines.findIndex((line) => /^- notes:/i.test(line));

  if (notesIndex < 0) {
    throw new Error("Manual QA evidence is missing result notes");
  }

  const inline = /^- notes:\s*(.*)$/i.exec(lines[notesIndex])?.[1].trim() ?? "";

  if (inline.length > 0) {
    return inline;
  }

  const body: string[] = [];

  for (const line of lines.slice(notesIndex + 1)) {
    const trimmed = line.trim();

    if (!trimmed || /^Release file preflight:/i.test(trimmed)) {
      break;
    }

    body.push(trimmed);
  }

  return body.join("\n").trim();
}

function markdownTable(rows: readonly [string, string][]): string {
  return ["| Field | Value |", "| --- | --- |", ...rows.map(([field, value]) => `| ${field} | ${value} |`)].join("\n");
}

export function formatManualQaEvidence(evidence: ManualQaEvidence): string {
  const missingFiles = evidence.files.filter((file) => file.status === "missing");
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
  const preUploadChecks = preUploadManualChecks(evidence.target).map((check) => `- [ ] ${check}`);
  const postUploadChecks = postUploadManualChecks(evidence.target).map((check) => `- [ ] ${check}`);
  const targetHostDetails = targetHostDetailFields(evidence.target).map((field) => `- ${field}:`);

  return [
    targetTitle(evidence.target),
    "",
    markdownTable(hostRows),
    "",
    "## Target Host Details",
    "",
    ...targetHostDetails,
    "",
    "## Release Files",
    "",
    "| File | Status | Bytes |",
    "| --- | --- | --- |",
    ...fileRows,
    "",
    "## Required Pre-Upload Manual Evidence",
    "",
    ...preUploadChecks,
    "",
    "## Required Post-Upload Evidence",
    "",
    ...postUploadChecks,
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

export async function verifyManualQaEvidence(options: VerifyManualQaEvidenceOptions): Promise<string[]> {
  const evidenceFile = resolve(options.evidenceFile);
  const stage = options.stage ?? "full";
  const source = await readFile(evidenceFile, "utf8");
  const requiredPreUploadEvidence = source.includes("## Required Pre-Upload Manual Evidence\n")
    ? section(source, "Required Pre-Upload Manual Evidence")
    : section(source, "Required Manual Evidence");
  const requiredPostUploadEvidence = source.includes("## Required Post-Upload Evidence\n")
    ? section(source, "Required Post-Upload Evidence")
    : requiredPreUploadEvidence;
  const targetHostDetails = section(source, "Target Host Details");
  const result = section(source, "Result");
  const messages: string[] = [];

  if (!source.includes(targetTitle(options.target))) {
    throw new Error(`${evidenceFile} is not a ${options.target} manual QA evidence file`);
  }

  if (!source.includes(`| os platform | ${expectedOsPlatform(options.target)} |`)) {
    throw new Error(`${evidenceFile} was not generated on ${expectedOsPlatform(options.target)}`);
  }

  if (!source.includes("Release file preflight: pass.")) {
    throw new Error(`${evidenceFile} did not record a passing release file preflight`);
  }

  verifyTargetHostDetails(targetHostDetails, options.target);

  for (const check of preUploadManualChecks(options.target)) {
    if (!checkedLine(requiredPreUploadEvidence, check)) {
      throw new Error(`${evidenceFile} has incomplete manual check: ${check}`);
    }
  }

  if (stage === "full") {
    for (const check of postUploadManualChecks(options.target)) {
      if (!checkedLine(requiredPostUploadEvidence, check)) {
        throw new Error(`${evidenceFile} has incomplete post-upload check: ${check}`);
      }
    }
  }

  if (!checkedLine(result, "pass")) {
    throw new Error(`${evidenceFile} does not mark the manual QA result as pass`);
  }

  if (checkedLine(result, "fail")) {
    throw new Error(`${evidenceFile} marks the manual QA result as fail`);
  }

  if (!resultNotes(result)) {
    throw new Error(`${evidenceFile} does not include manual QA result notes`);
  }

  messages.push(`${evidenceFile} has all ${manualChecks(options.target, stage).length} required ${stage} manual checks marked pass.`);
  messages.push(`${evidenceFile} records target-host details, a passing release file preflight, pass result, and result notes.`);

  return messages;
}

export function verifyManualQaEvidenceTemplate(source: string, target: ManualQaTarget): string[] {
  const requiredPreUploadEvidence = section(source, "Required Pre-Upload Manual Evidence");
  const requiredPostUploadEvidence = section(source, "Required Post-Upload Evidence");
  const targetHostDetails = section(source, "Target Host Details");
  const result = section(source, "Result");

  if (!source.includes(targetTitle(target))) {
    throw new Error(`Manual QA evidence template is not a ${target} template`);
  }

  if (!source.includes(`| os platform | ${expectedOsPlatform(target)} |`)) {
    throw new Error(`Manual QA evidence template was not generated on ${expectedOsPlatform(target)}`);
  }

  if (!source.includes("Release file preflight: pass.")) {
    throw new Error("Manual QA evidence template did not record a passing release file preflight");
  }

  for (const field of targetHostDetailFields(target)) {
    if (!new RegExp(`^- ${field}:[ \t]*$`, "im").test(targetHostDetails)) {
      throw new Error(`Manual QA evidence template is missing blank target-host detail: ${field}`);
    }
  }

  for (const check of preUploadManualChecks(target)) {
    if (!uncheckedLine(requiredPreUploadEvidence, check)) {
      throw new Error(`Manual QA evidence template is missing current pre-upload check: ${check}`);
    }
  }

  for (const check of postUploadManualChecks(target)) {
    if (!uncheckedLine(requiredPostUploadEvidence, check)) {
      throw new Error(`Manual QA evidence template is missing current post-upload check: ${check}`);
    }
  }

  if (!uncheckedLine(result, "pass") || !uncheckedLine(result, "fail") || !/^- notes:\s*$/m.test(result)) {
    throw new Error("Manual QA evidence template does not have a blank result section");
  }

  return [
    `Manual QA evidence template has ${manualChecks(target).length} current required checks.`,
    "Manual QA evidence template records blank target-host details, a passing release file preflight, and blank result section."
  ];
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
  const verifyFile = argValue("--verify");

  if (verifyFile) {
    const target = normalizeManualQaTarget(targetArg ?? defaultTarget());
    const stage = normalizeVerificationStage(argValue("--stage"));
    const messages = await verifyManualQaEvidence({ evidenceFile: verifyFile, stage, target });

    for (const message of messages) {
      console.log(message);
    }

    return;
  }

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
