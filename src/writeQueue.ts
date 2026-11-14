export class WriteDiscardedError extends Error {
  constructor() { super('Unsaved edits discarded.'); }
}

interface PendingWrite<T> {
  work: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** failed commands stay queued, including commands already waiting behind them. */
export class WriteQueue<T> {
  private writes: PendingWrite<T>[] = [];
  private running = false;
  private paused = false;

  private readonly onFailure: (error: unknown) => void;
  constructor(onFailure: (error: unknown) => void) { this.onFailure = onFailure; }

  enqueue(work: () => Promise<T>): Promise<T> {
    const result = new Promise<T>((resolve, reject) => { this.writes.push({ work, resolve, reject }); });
    void this.drain();
    return result;
  }

  get failed(): boolean { return this.paused; }

  retry(): void {
    this.paused = false;
    void this.drain();
  }

  discard(): void {
    if (this.running) throw new Error('Wait for the current save before discarding edits.');
    const discarded = this.writes.splice(0);
    this.paused = false;
    for (const write of discarded) write.reject(new WriteDiscardedError());
  }

  private async drain(): Promise<void> {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      while (this.writes.length && !this.paused) {
        const write = this.writes[0];
        try {
          const result = await write.work();
          this.writes.shift();
          write.resolve(result);
        } catch (error) {
          this.paused = true;
          this.onFailure(error);
        }
      }
    } finally { this.running = false; }
  }
}
