import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CoreStore } from "./coreStore";
import { appLogger } from "../diagnostics/appLogger";

export class LocalBackupService {
  readonly directory: string;
  private inFlight: Promise<string> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: CoreStore, userDataDirectory: string) {
    this.directory = join(userDataDirectory, "backups");
  }

  create(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.writeSnapshot().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async writeSnapshot(): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const name = `hcb-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.sqlite`;
    const target = join(this.directory, name);
    const temporary = `${target}.partial`;
    try {
      await this.store.backupTo(temporary);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    this.store.dispatch("settings", "update", { lastLocalBackupAt: new Date().toISOString() });
    const settings = this.store.dispatch("settings", "get", {});
    const retention = Math.max(1, Math.min(365, Math.floor(Number(settings.localBackupRetentionCount)) || 14));
    const snapshots = (await readdir(this.directory)).filter((file) => /^hcb-[\w-]+\.sqlite$/.test(file)).sort().reverse();
    for (const old of snapshots.slice(retention)) await rm(join(this.directory, old));
    return target;
  }

  start(): void {
    if (this.timer) clearInterval(this.timer);
    const run = async () => {
      const settings = this.store.dispatch("settings", "get", {});
      if (!settings.dailyLocalBackupEnabled) return;
      const previous = Date.parse(settings.lastLocalBackupAt ?? "");
      if (Number.isFinite(previous) && Date.now() - previous < 24 * 60 * 60_000) return;
      try { await this.create(); }
      catch (error) { appLogger.warn("Local backup failed", "backups", { error: String(error) }); }
    };
    void run();
    this.timer = setInterval(() => void run(), 60 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.inFlight?.catch(() => undefined);
  }
}
