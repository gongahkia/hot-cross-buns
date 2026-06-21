import { spawn, spawnSync } from "node:child_process";

function commandName(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function gitCommit(): string {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });

  if (result.status !== 0) {
    return "unknown";
  }

  return result.stdout.trim() || "unknown";
}

function buildDate(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const child = spawn(commandName("pnpm"), ["build"], {
  env: {
    ...process.env,
    HCB_BUILD_COMMIT: gitCommit(),
    HCB_BUILD_DATE: buildDate(),
    HCB_PACKAGE_TOOL: "electron-builder"
  },
  shell: process.platform === "win32",
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
