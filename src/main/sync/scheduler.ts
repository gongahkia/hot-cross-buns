import type { SettingsSnapshot, SyncRunNowRequest } from "@shared/ipc/contracts";

export interface SyncSchedulerOptions {
  getSettings: () => SettingsSnapshot;
  runNow: (request: SyncRunNowRequest) => Promise<unknown>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export class SyncScheduler {
  private timer: TimerHandle | undefined;
  private started = false;
  private running = false;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(private readonly options: SyncSchedulerOptions) {
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.applySettings(this.options.getSettings());
  }

  applySettings(settings: SettingsSnapshot): void {
    this.clear();

    if (
      !this.started ||
      settings.syncMode === "manual" ||
      (!settings.syncTasksEnabled && !settings.syncCalendarEventsEnabled)
    ) {
      return;
    }

    this.schedule(settings.syncMode === "near-real-time" ? 30_000 : 2_000);
  }

  triggerSoon(delayMs = 250): void {
    const settings = this.options.getSettings();

    if (
      settings.syncMode === "manual" ||
      (!settings.syncTasksEnabled && !settings.syncCalendarEventsEnabled)
    ) {
      return;
    }

    this.clear();
    this.schedule(delayMs);
  }

  stop(): void {
    this.started = false;
    this.clear();
  }

  private schedule(delayMs: number): void {
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.runScheduled();
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private async runScheduled(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.options.runNow({
        resources: ["tasks", "calendar"],
        dryRun: false,
        full: false
      });
    } catch {
      // Sync status and diagnostics own sanitized failure reporting.
    } finally {
      this.running = false;
      const settings = this.options.getSettings();

      if (this.started && settings.syncMode === "near-real-time") {
        this.schedule(5 * 60_000 + Math.round(Math.random() * 30_000));
      }
    }
  }

  private clear(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }
}
