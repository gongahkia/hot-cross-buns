import { spawn } from "node:child_process";

function commandName(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: tsx scripts/electron-builder-preview.ts <electron-builder args>");
  process.exit(1);
}

const child = spawn(commandName("electron-builder"), args, {
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false"
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
