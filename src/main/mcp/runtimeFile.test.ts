import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeMcpRuntimeFile, writeMcpRuntimeFile } from "./runtimeFile";

describe("MCP runtime file", () => {
  it("writes non-secret loopback discovery metadata and removes it", () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-mcp-runtime-"));
    const file = join(directory, "config", "mcp-runtime.json");

    try {
      const runtime = writeMcpRuntimeFile(file, 4777, new Date("2026-06-04T00:00:00.000Z"));
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

      expect(runtime).toMatchObject({
        running: true,
        url: "http://127.0.0.1",
        port: 4777,
        updatedAt: "2026-06-04T00:00:00.000Z"
      });
      expect(parsed).toMatchObject(runtime);
      expect(JSON.stringify(parsed)).not.toMatch(/token|secret|bearer/i);

      removeMcpRuntimeFile(file);
      expect(() => readFileSync(file, "utf8")).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
