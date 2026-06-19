#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const root = dirname(dirname(__filename));
const tsxBin = process.platform === "win32"
  ? join(root, "node_modules", ".bin", "tsx.cmd")
  : join(root, "node_modules", ".bin", "tsx");
const tsx = existsSync(tsxBin) ? tsxBin : "tsx";
const result = spawnSync(tsx, [join(root, "scripts", "hcb.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exitCode = 1;
} else if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.status ?? 0;
}
