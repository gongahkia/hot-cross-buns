import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  packagedMcpSmokeChildEnv,
  packagedMcpSmokePersistedChildEnv,
  packagedMcpSmokeRequested,
  runPackagedMcpSmoke
} from "./packaged-mcp-smoke";

const DEFAULT_RELEASE_DIR = "release";
const stableX64InstallerName = "Hot-Cross-Buns-2-windows-x64.exe";
const installedExecutableName = "Hot Cross Buns 2.exe";
const shortcutName = "Hot Cross Buns 2.lnk";
const versionedInstallerPattern = /^Hot-Cross-Buns-2-\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?-windows-x64\.exe$/;

interface SmokeInstallOptions {
  artifact?: string;
  installDir?: string;
  mcpSmoke?: boolean;
  releaseDir?: string;
  launchWaitMs?: number;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

interface ShortcutMetadata {
  iconLocation: string;
  targetPath: string;
  workingDirectory: string;
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

export async function smokeInstallWindowsNsis(options: SmokeInstallOptions = {}): Promise<string[]> {
  if (process.platform !== "win32") {
    throw new Error("Windows NSIS install smoke must run on Windows.");
  }

  const releaseDir = resolve(options.releaseDir ?? DEFAULT_RELEASE_DIR);
  const installer = options.artifact ? resolve(options.artifact) : await findInstaller(releaseDir);
  const tempRoot = options.installDir
    ? undefined
    : await mkdtemp(join(tmpdir(), "hcb2-nsis-install-smoke-"));
  const installDir = resolve(options.installDir ?? join(tempRoot ?? tmpdir(), "app"));
  const userDataDir = join(tempRoot ?? installDir, "user-data");
  const shortcutPaths = windowsShortcutPaths(process.env);
  const preexistingShortcuts = new Set(shortcutPaths.filter((shortcutPath) => existsSync(shortcutPath)));
  const messages: string[] = [];

  try {
    await runProcess(installer, nsisSilentInstallArgs(installDir), { timeoutMs: 120_000 });
    const appExe = installedExecutablePath(installDir);

    if (!existsSync(appExe) || !(await stat(appExe)).isFile()) {
      throw new Error(`Installed app executable missing at ${appExe}`);
    }

    messages.push(`${basename(installer)} installed to ${installDir}.`);
    messages.push(...await verifyInstalledShortcuts(shortcutPaths, appExe));
    const mcpSmoke = options.mcpSmoke ?? packagedMcpSmokeRequested(process.env);
    messages.push(...await launchInstalledApp(appExe, userDataDir, {
      mcpSmoke,
      waitMs: options.launchWaitMs ?? 8_000
    }));
    messages.push(`${installedExecutableName} launched from the installed path with isolated user data.`);

    if (mcpSmoke) {
      messages.push(...await launchInstalledApp(appExe, userDataDir, {
        mcpSmoke: true,
        persistedMcpToken: true,
        waitMs: options.launchWaitMs ?? 8_000
      }));
      messages.push(`${installedExecutableName} relaunched and reused the persisted MCP bearer token through safeStorage.`);
    }

    const uninstaller = await findUninstaller(installDir);
    await runProcess(uninstaller, ["/S"], { timeoutMs: 120_000 });
    await waitForPathToDisappear(appExe, 30_000);
    await waitForNewShortcutsToDisappear(shortcutPaths, preexistingShortcuts, 30_000);

    messages.push(`${basename(uninstaller)} completed; installed executable and new shortcuts are absent.`);
    return messages;
  } finally {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Windows NSIS install smoke temp cleanup skipped: ${message}`);
      });
    }
  }
}

export function nsisSilentInstallArgs(installDir: string): string[] {
  return ["/S", `/D=${installDir}`];
}

export function installedExecutablePath(installDir: string): string {
  return join(installDir, installedExecutableName);
}

export function windowsShortcutPaths(env: NodeJS.ProcessEnv): string[] {
  const appData = requiredEnv(env, "APPDATA");
  const userProfile = requiredEnv(env, "USERPROFILE");

  return [
    win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", shortcutName),
    win32.join(userProfile, "Desktop", shortcutName)
  ];
}

export function shortcutMetadataPowerShell(shortcutPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$shell = New-Object -ComObject WScript.Shell",
    `$shortcut = $shell.CreateShortcut(${powerShellSingleQuoted(shortcutPath)})`,
    "[pscustomobject]@{",
    "  TargetPath = $shortcut.TargetPath",
    "  WorkingDirectory = $shortcut.WorkingDirectory",
    "  IconLocation = $shortcut.IconLocation",
    "} | ConvertTo-Json -Compress"
  ].join("\n");
}

export async function findUninstaller(installDir: string): Promise<string> {
  const entries = await readdir(installDir, { withFileTypes: true });
  const candidate = entries.find((entry) =>
    entry.isFile() &&
    extname(entry.name).toLowerCase() === ".exe" &&
    /^Uninstall .+\.exe$/i.test(entry.name)
  );

  if (!candidate) {
    throw new Error(`No NSIS uninstaller found in ${installDir}`);
  }

  return join(installDir, candidate.name);
}

async function findInstaller(releaseDir: string): Promise<string> {
  const stable = join(releaseDir, stableX64InstallerName);

  if (existsSync(stable)) {
    return stable;
  }

  const entries = await readdir(releaseDir, { withFileTypes: true });
  const candidates = (
    await Promise.all(
      entries.map(async (entry) => {
        const filePath = join(releaseDir, entry.name);

        if (!entry.isFile() || !versionedInstallerPattern.test(entry.name)) {
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
    throw new Error(`No Windows x64 NSIS installer found in ${releaseDir}`);
  }

  return latest.filePath;
}

async function verifyInstalledShortcuts(shortcutPaths: string[], appExe: string): Promise<string[]> {
  const messages: string[] = [];

  for (const shortcutPath of shortcutPaths) {
    if (!existsSync(shortcutPath)) {
      throw new Error(`NSIS shortcut missing at ${shortcutPath}`);
    }

    const metadata = await readShortcutMetadata(shortcutPath);

    if (!await sameWindowsPath(metadata.targetPath, appExe)) {
      throw new Error(`${basename(shortcutPath)} targets ${metadata.targetPath || "<empty>"} instead of ${appExe}`);
    }

    messages.push(`${basename(shortcutPath)} points to the installed app executable.`);
  }

  return messages;
}

async function readShortcutMetadata(shortcutPath: string): Promise<ShortcutMetadata> {
  const result = await runProcess("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    shortcutMetadataPowerShell(shortcutPath)
  ], { timeoutMs: 30_000 });
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

  return {
    iconLocation: stringValue(parsed, "IconLocation", "iconLocation"),
    targetPath: stringValue(parsed, "TargetPath", "targetPath"),
    workingDirectory: stringValue(parsed, "WorkingDirectory", "workingDirectory")
  };
}

async function launchInstalledApp(
  appExe: string,
  userDataDir: string,
  options: { mcpSmoke: boolean; persistedMcpToken?: boolean; waitMs: number }
): Promise<string[]> {
  const baseEnv = {
    ...process.env,
    HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
    HCB_USER_DATA_DIR: userDataDir
  };
  const childEnv = options.mcpSmoke
    ? options.persistedMcpToken
      ? packagedMcpSmokePersistedChildEnv(userDataDir, baseEnv, appExe)
      : packagedMcpSmokeChildEnv(userDataDir, baseEnv, appExe)
    : baseEnv;
  const child = spawn(appExe, ["--disable-gpu"], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let exited = false;
  let exitCode: number | null = null;
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  try {
    const messages = options.mcpSmoke
      ? await runPackagedMcpSmoke({
          env: childEnv,
          platform: "win32"
        })
      : await new Promise<string[]>((resolveWait) => setTimeout(() => resolveWait([]), options.waitMs));

    if (exited) {
      throw new Error(`${installedExecutableName} exited during launch smoke with code ${exitCode ?? "unknown"}: ${firstOutputLine(stderr || stdout)}`);
    }

    return messages;
  } finally {
    await killProcessTree(child.pid);
  }
}

async function waitForNewShortcutsToDisappear(
  shortcutPaths: string[],
  preexistingShortcuts: Set<string>,
  timeoutMs: number
): Promise<void> {
  for (const shortcutPath of shortcutPaths) {
    if (!preexistingShortcuts.has(shortcutPath)) {
      await waitForPathToDisappear(shortcutPath, timeoutMs);
    }
  }
}

async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) {
    return;
  }

  await runProcess("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeoutMs: 30_000 }).catch(() => undefined);
}

async function waitForPathToDisappear(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (existsSync(path) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  if (existsSync(path)) {
    throw new Error(`${basename(path)} still exists after silent uninstall.`);
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, name: "APPDATA" | "USERPROFILE"): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for Windows NSIS shortcut smoke.`);
  }

  return value;
}

function powerShellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function sameWindowsPath(left: string, right: string): Promise<boolean> {
  const [resolvedLeft, resolvedRight] = await Promise.all([
    realWindowsPath(left),
    realWindowsPath(right)
  ]);

  return win32.normalize(resolvedLeft).toLowerCase() === win32.normalize(resolvedRight).toLowerCase();
}

function stringValue(record: Record<string, unknown>, pascalKey: string, camelKey: string): string {
  const value = record[pascalKey] ?? record[camelKey];

  return typeof value === "string" ? value : "";
}

async function realWindowsPath(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

function runProcess(command: string, args: string[], options: { timeoutMs: number }): Promise<ProcessResult> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectProcess(new Error(`${basename(command)} timed out.`));
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectProcess(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        rejectProcess(new Error(`${basename(command)} exited ${code ?? "unknown"}: ${firstOutputLine(stderr || stdout)}`));
        return;
      }

      resolveProcess({ stdout, stderr });
    });
  });
}

function firstOutputLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0]?.slice(0, 500) ?? "";
}

async function main(): Promise<void> {
  const releaseDir = resolve(process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : argValue("--dir", DEFAULT_RELEASE_DIR));
  const artifact = argValue("--artifact", "");
  const installDir = argValue("--install-dir", "");
  const launchWaitMs = Number.parseInt(argValue("--launch-wait-ms", "8000"), 10);
  const mcpSmoke = process.env.HCB_PACKAGED_MCP_SMOKE === "1";
  const messages = await smokeInstallWindowsNsis({
    releaseDir,
    ...(artifact ? { artifact } : {}),
    ...(installDir ? { installDir } : {}),
    mcpSmoke,
    launchWaitMs: Number.isFinite(launchWaitMs) ? launchWaitMs : 8_000
  });

  for (const message of messages) {
    console.log(message);
  }

  console.log("Windows interactive launch paths, protocol, notification, SmartScreen, and retained-data behavior still require manual QA.");
}

const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
