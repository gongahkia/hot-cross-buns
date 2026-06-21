import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HcbMcpRuntimeFile } from "@shared/mcpRuntime";

export function writeMcpRuntimeFile(path: string, port: number, now = new Date()): HcbMcpRuntimeFile {
  const runtime: HcbMcpRuntimeFile = {
    running: true,
    url: "http://127.0.0.1",
    port,
    pid: process.pid,
    updatedAt: now.toISOString()
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(runtime, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  return runtime;
}

export function removeMcpRuntimeFile(path: string): void {
  rmSync(path, { force: true });
}
