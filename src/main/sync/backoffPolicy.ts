import { GoogleApiError } from "../google";

export interface SyncBackoffPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  maxAttempts?: number;
  random?: () => number;
}

export class SyncBackoffPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterMs: number;
  readonly maxAttempts: number;
  private readonly random: () => number;

  constructor(options: SyncBackoffPolicyOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 90_000;
    this.maxDelayMs = options.maxDelayMs ?? 600_000;
    this.jitterMs = options.jitterMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 6;
    this.random = options.random ?? Math.random;
  }

  delayMsForAttempt(attempt: number): number {
    const clampedAttempt = Math.max(0, Math.min(Math.floor(attempt), this.maxAttempts));
    const exponentialDelay = this.baseDelayMs * 2 ** clampedAttempt;
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
    const jitter = Math.round(this.jitterMs * Math.min(1, Math.max(0, this.random())));

    return Math.min(cappedDelay + jitter, this.maxDelayMs + this.jitterMs);
  }

  retryDelayMs(error: unknown, attempt: number): number | undefined {
    if (!this.shouldBackoff(error)) {
      return undefined;
    }

    if (error instanceof GoogleApiError && error.retryAfterMs !== undefined) {
      return error.retryAfterMs;
    }

    return this.delayMsForAttempt(attempt);
  }

  shouldBackoff(error: unknown): boolean {
    if (!(error instanceof GoogleApiError)) {
      return false;
    }

    if (error.quotaExceeded) {
      return false;
    }

    return error.kind === "rate_limited" || error.kind === "server";
  }
}
