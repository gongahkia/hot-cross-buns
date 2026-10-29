import { recordTiming } from '@shared/core/performance';

/** One sync continuation owns SQL; HTTP waits temporarily return its writer lock. */
export class WorkspaceLease {
  private releaseLock?: () => void;
  private released?: Promise<void>;

  constructor(private readonly locks: LockManager, private readonly name: string) {}

  async acquire(): Promise<void> {
    if (this.releaseLock) throw new Error('Workspace lease is already held.');
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const released = this.locks.request(this.name, { mode: 'exclusive' }, async () => {
        recordTiming({ name: 'workspace.lock.wait', kind: 'worker', durationMs: performance.now() - started });
        await new Promise<void>(release => { this.releaseLock = release; resolve(); });
      }).then(() => {});
      this.released = released;
      void released.catch(reject);
    });
  }

  async release(): Promise<void> {
    this.releaseLock?.();
    this.releaseLock = undefined;
    await this.released;
  }

  async outside<T>(wait: () => Promise<T>, before: () => Promise<void>, resume: () => Promise<void>): Promise<T> {
    if (!this.releaseLock) throw new Error('A network wait requires the workspace lease.');
    await before();
    await this.release();
    try { return await wait(); }
    finally {
      // Even a rejected HTTP request must resume against current durable state
      // before its caller may record retry/conflict information.
      await this.acquire();
      await resume();
    }
  }
}
