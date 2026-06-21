import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  packagedMcpSmokeChildEnv,
  packagedMcpSmokeRequested,
  runPackagedMcpSmoke
} from "./packaged-mcp-smoke";

const DEFAULT_RELEASE_DIR = "release";
const stableAppImageName = "Hot-Cross-Buns-linux.AppImage";
const stableX64AppImageName = "Hot-Cross-Buns-linux-x64.AppImage";
const checksumManifestName = "SHASUMS256.txt";
const launchTimeoutMs = 12_000;
const minimumAppImageBytes = 20 * 1024 * 1024;
const versionedAppImagePattern = /^Hot-Cross-Buns-\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?-linux-(x64|x86_64|arm64|aarch64)\.AppImage$/;
const requiredDesktopFields = new Map([
  ["Name", "Hot Cross Buns"],
  ["Type", "Application"],
  ["Terminal", "false"],
  ["Categories", "Office;"],
  ["GenericName", "Planner"],
  ["StartupWMClass", "hot-cross-buns"]
]);

interface SmokeOptions {
  artifact?: string;
  launch?: boolean;
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

export async function smokeLinuxAppImageArtifact(options: SmokeOptions = {}): Promise<string[]> {
  const releaseDir = resolve(options.releaseDir ?? DEFAULT_RELEASE_DIR);
  const minimumBytes = options.minimumBytes ?? minimumAppImageBytes;
  const requestedArtifact = options.artifact ? resolve(options.artifact) : undefined;
  const versionedAppImage = requestedArtifact ?? await findVersionedAppImage(releaseDir);
  const requiredArtifacts = uniquePaths([
    versionedAppImage,
    join(releaseDir, stableAppImageName),
    join(releaseDir, stableX64AppImageName)
  ]);
  const manifestPath = join(releaseDir, checksumManifestName);
  const manifestEntries = parseChecksumManifest(await readFile(manifestPath, "utf8"));
  const artifactHashes = new Map<string, string>();
  const messages: string[] = [];

  verifyManifestContainsOnlyTopLevelArtifacts(manifestEntries);

  for (const artifact of requiredArtifacts) {
    const artifactStats = await stat(artifact);

    if (!artifactStats.isFile()) {
      throw new Error(`${artifact} is not a file`);
    }

    if (artifactStats.size < minimumBytes) {
      throw new Error(`${basename(artifact)} is unexpectedly small for a Linux AppImage.`);
    }

    if ((artifactStats.mode & 0o111) === 0) {
      throw new Error(`${basename(artifact)} is not executable; run chmod +x before smoke testing.`);
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
    messages.push(`${basename(artifact)} exists, is executable, is ${artifactStats.size} bytes, and has matching SHA-256 metadata.`);
  }

  verifyStableAliasMatchesVersionedArtifact(artifactHashes, versionedAppImage, join(releaseDir, stableAppImageName));
  verifyStableAliasMatchesVersionedArtifact(artifactHashes, versionedAppImage, join(releaseDir, stableX64AppImageName));

  const workDir = await mkdtemp(join(tmpdir(), "hcb-appimage-smoke-"));

  try {
    await extractAppImage(versionedAppImage, workDir);
    await verifyDesktopEntry(workDir);

    if (options.launch) {
      messages.push(...await launchAppImage(versionedAppImage, workDir));
    } else {
      messages.push("Skipped AppImage launch; set HCB_APPIMAGE_SMOKE_LAUNCH=1 to launch with isolated user data.");
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  return messages;
}

async function findVersionedAppImage(releaseDir: string): Promise<string> {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const candidates = (
    await Promise.all(
      entries.map(async (entry) => {
        const filePath = join(releaseDir, entry.name);

        if (!entry.isFile() || extname(entry.name) !== ".AppImage" || !versionedAppImagePattern.test(entry.name)) {
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
    throw new Error(`No versioned Linux AppImage artifact found in ${releaseDir}`);
  }

  return latest.filePath;
}

function runCommand(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          rejectRun(new Error(`${basename(command)} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      rejectRun(error);
    });
    child.on("close", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      const output = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };

      if (code === 0) {
        resolveRun(output);
        return;
      }

      rejectRun(new Error(`${basename(command)} exited with ${code ?? "unknown"}: ${output.stderr || output.stdout}`));
    });
  });
}

async function extractAppImage(artifact: string, workDir: string): Promise<void> {
  await runCommand(artifact, ["--appimage-extract"], {
    cwd: workDir,
    timeoutMs: 60_000
  });
}

async function verifyDesktopEntry(workDir: string): Promise<void> {
  const desktopPath = join(workDir, "squashfs-root", "hot-cross-buns.desktop");
  const desktop = await readFile(desktopPath, "utf8");

  for (const [field, expected] of requiredDesktopFields) {
    const line = `${field}=${expected}`;

    if (!desktop.includes(line)) {
      throw new Error(`AppImage desktop metadata is missing ${line}`);
    }
  }

  if (desktop.includes("x-scheme-handler/hotcrossbuns")) {
    throw new Error("AppImage desktop metadata must not register hotcrossbuns:// while Linux deep links are explicitly unsupported.");
  }
}

async function launchAppImage(artifact: string, workDir: string): Promise<string[]> {
  const userDataDir = join(workDir, "user-data");
  const launchArgs = appImageLaunchArgs(process.env);
  const launchEnv = {
    ...process.env,
    HCB_ALLOW_PACKAGED_USER_DATA_DIR: "1",
    HCB_USER_DATA_DIR: userDataDir,
    ELECTRON_ENABLE_LOGGING: "1"
  };
  const childEnv = packagedMcpSmokeRequested(process.env)
    ? packagedMcpSmokeChildEnv(userDataDir, launchEnv, artifact)
    : launchEnv;
  const mcpSmoke = packagedMcpSmokeRequested(childEnv);
  const messages: string[] = [];

  await mkdir(userDataDir, { recursive: true });

  const child = spawn(artifact, launchArgs, {
    cwd: workDir,
    detached: true,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output: Buffer[] = [];

  child.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => output.push(Buffer.from(chunk)));

  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    let forceKillTimeout: NodeJS.Timeout | null = null;
    let settled = false;
    let stopping = false;
    const reject = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      rejectLaunch(error);
    };
    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      resolveLaunch();
    };
    const stopApp = () => {
      stopping = true;
      signalAppImage(child.pid, "SIGTERM");
      forceKillTimeout = setTimeout(() => {
        signalAppImage(child.pid, "SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        settle();
      }, 1_500);
    };
    const failAndStop = (error: Error) => {
      stopping = true;
      signalAppImage(child.pid, "SIGTERM");
      signalAppImage(child.pid, "SIGKILL");
      reject(error);
    };
    const timeout = setTimeout(() => {
      if (mcpSmoke) {
        failAndStop(new Error("Packaged AppImage MCP smoke timed out."));
        return;
      }

      stopApp();
    }, mcpSmoke ? 35_000 : launchTimeoutMs);

    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (!stopping && (code !== 0 || mcpSmoke)) {
        reject(new Error(
          `AppImage launch exited with ${code ?? signal ?? "unknown"} before smoke timeout.${launchOutputSuffix(output)}`
        ));
        return;
      }

      settle();
    });

    if (mcpSmoke) {
      void runPackagedMcpSmoke({
        env: childEnv,
        platform: "linux"
      })
        .then((smokeMessages) => {
          messages.push(...smokeMessages);
          stopApp();
        })
        .catch((error: unknown) => {
          failAndStop(error instanceof Error ? error : new Error(String(error)));
        });
    }
  });

  const logs = Buffer.concat(output).toString("utf8");

  if (!logs.trim()) {
    throw new Error("AppImage launch produced no startup logs.");
  }

  return messages;
}

function appImageLaunchArgs(env: NodeJS.ProcessEnv): string[] {
  const args: string[] = [];
  const passwordStore = env.HCB_APPIMAGE_SMOKE_PASSWORD_STORE?.trim();

  if (env.HCB_APPIMAGE_SMOKE_NO_SANDBOX === "1") {
    args.push("--no-sandbox");
  }

  if (passwordStore) {
    if (!/^(basic|gnome-libsecret|kwallet|kwallet5|kwallet6)$/.test(passwordStore)) {
      throw new Error("HCB_APPIMAGE_SMOKE_PASSWORD_STORE must be basic, gnome-libsecret, kwallet, kwallet5, or kwallet6.");
    }

    args.push(`--password-store=${passwordStore}`);
  }

  return args;
}

function launchOutputSuffix(output: Buffer[]): string {
  const logs = Buffer.concat(output).toString("utf8").trim();

  if (!logs) {
    return "";
  }

  return ` Output: ${logs.slice(0, 1_000)}`;
}

function verifyStableAliasMatchesVersionedArtifact(hashes: Map<string, string>, versionedArtifact: string, aliasArtifact: string): void {
  const versionedHash = hashes.get(resolve(versionedArtifact));
  const aliasHash = hashes.get(resolve(aliasArtifact));

  if (!versionedHash || !aliasHash || versionedHash !== aliasHash) {
    throw new Error(`${basename(aliasArtifact)} does not match ${basename(versionedArtifact)}; regenerate Linux stable aliases.`);
  }
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

function signalAppImage(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) {
    return;
  }

  try {
    process.kill(-pid, signal);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ESRCH") {
      try {
        process.kill(pid, signal);
      } catch (fallbackError) {
        if ((fallbackError as NodeJS.ErrnoException).code !== "ESRCH") {
          throw fallbackError;
        }
      }
    }
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
  const minimumBytes = Number.parseInt(argValue("--min-bytes", String(minimumAppImageBytes)), 10);
  const messages = await smokeLinuxAppImageArtifact({
    releaseDir,
    ...(artifact ? { artifact } : {}),
    launch: process.env.HCB_APPIMAGE_SMOKE_LAUNCH === "1",
    minimumBytes: Number.isFinite(minimumBytes) ? minimumBytes : minimumAppImageBytes
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
