import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  packagedMcpSmokeChildEnv,
  packagedMcpSmokeRequested,
  runPackagedMcpSmoke
} from "./packaged-mcp-smoke";

const DEFAULT_RELEASE_DIR = "release";
const stableX64InstallerName = "Hot-Cross-Buns-2-windows-x64.exe";
const installedExecutableName = "Hot Cross Buns 2.exe";
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
  const messages: string[] = [];

  try {
    await runProcess(installer, nsisSilentInstallArgs(installDir), { timeoutMs: 120_000 });
    const appExe = installedExecutablePath(installDir);

    if (!existsSync(appExe) || !(await stat(appExe)).isFile()) {
      throw new Error(`Installed app executable missing at ${appExe}`);
    }

    messages.push(`${basename(installer)} installed to ${installDir}.`);
    messages.push(...await launchInstalledApp(appExe, userDataDir, {
      mcpSmoke: options.mcpSmoke ?? packagedMcpSmokeRequested(process.env),
      waitMs: options.launchWaitMs ?? 8_000
    }));
    messages.push(`${installedExecutableName} launched from the installed path with isolated user data.`);

    const uninstaller = await findUninstaller(installDir);
    await runProcess(uninstaller, ["/S"], { timeoutMs: 120_000 });
    await waitForPathToDisappear(appExe, 30_000);

    messages.push(`${basename(uninstaller)} completed and removed the installed app executable.`);
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

async function launchInstalledApp(
  appExe: string,
  userDataDir: string,
  options: { mcpSmoke: boolean; waitMs: number }
): Promise<string[]> {
  const baseEnv = {
    ...process.env,
    HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
    HCB_USER_DATA_DIR: userDataDir
  };
  const childEnv = options.mcpSmoke ? packagedMcpSmokeChildEnv(userDataDir, baseEnv) : baseEnv;
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
