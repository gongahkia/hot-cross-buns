export interface GoogleSyncOAuth {
  googleFetch(accountId: string, url: string | URL, init?: RequestInit): Promise<Response>;
  onConnectionChange(listener: () => void): () => void;
}

export interface GoogleUploadSource {
  name: string;
  type?: string;
  size: number;
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
}

export interface SyncCheckpoint {
  stage: 'before-remote-write' | 'mutation-receipt' | 'mutation-error' | 'pull-complete' | 'resolution' | 'sync-status' | 'upload-receipt';
  mutationId?: string;
}

export interface GoogleSyncPlatform {
  /** Must finish durable persistence, not merely SQL COMMIT. Caller holds the writer lock. */
  checkpoint?(checkpoint: SyncCheckpoint): Promise<void>;
  yieldToRequests?(): Promise<void>;
  fingerprint?(value: string): string | Promise<string>;
  /** Browser connection callbacks are queued by the worker's authoritative writer. */
  automaticConnectionSync?: boolean;
  accountCapabilities?(accountId: string): { tasks: boolean; calendar: boolean };
  /** Durable operation identities survive sync-token reset, reconnect, and crashes. */
  operations?: {
    read(accountId: string, key: string): Record<string, any> | null;
    write(accountId: string, key: string, value: Record<string, any>): void;
  };
}

/** Never convert a failed durable checkpoint into an HTTP retry or continue remote writes. */
export class SyncPersistenceError extends Error {
  constructor(readonly checkpoint: SyncCheckpoint, cause: unknown) {
    super(`Google sync could not save its ${checkpoint.stage} checkpoint. Stop and reload before syncing again.`, { cause });
    this.name = 'SyncPersistenceError';
  }
}
