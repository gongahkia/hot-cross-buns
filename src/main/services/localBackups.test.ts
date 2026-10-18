import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalBackupService } from "./localBackups";

describe("backup shutdown", () => {
  it("waits for the in-flight snapshot and its atomic final rename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hcb-backup-shutdown-"));
    let release!: () => void, started!: () => void;
    const active = new Promise<void>((resolve) => { started = resolve; });
    const writing = new Promise<void>((resolve) => { release = resolve; });
    const store = { backupTo: async (path: string) => { started(); await writing; await writeFile(path, "snapshot fixture"); }, dispatch: () => ({ localBackupRetentionCount: 14 }) };
    const service = new LocalBackupService(store as never, directory);
    try {
      const creating = service.create();
      expect(service.create()).toBe(creating);
      await active;
      let closed = false;
      const closing = service.shutdown().then(() => { closed = true; });
      await Promise.resolve();
      expect(closed).toBe(false);
      release();
      const path = await creating;
      await closing;
      expect(await readFile(path, "utf8")).toBe("snapshot fixture");
      expect((await readdir(service.directory)).some((file) => file.endsWith(".partial"))).toBe(false);
    } finally { release(); await service.shutdown(); await rm(directory, { recursive: true, force: true }); }
  });
});
