export type AutomaticSyncReason = 'interval' | 'foreground' | 'online' | 'local-mutation' | 'workspace-change';
export interface SyncSchedule {
  attemptedAt: number;
  finishedAt: number;
  failures: number;
  retryAfter: number;
}
export const syncScheduleKey = 'browser-sync-schedule-v1';

/** Ignore corrupt/imported future clocks instead of indefinitely suppressing sync. */
export function readSyncSchedule(value: unknown, now: number): SyncSchedule {
  const state = value as Partial<SyncSchedule> | null;
  if (!state || ![state.attemptedAt, state.finishedAt, state.failures, state.retryAfter].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) ||
      state.attemptedAt! > now || state.finishedAt! > now || state.failures! > 10 || state.retryAfter! > now + 15 * 60_000) {
    return { attemptedAt: 0, finishedAt: 0, failures: 0, retryAfter: 0 };
  }
  return state as SyncSchedule;
}

export function shouldSyncAutomatically(state: SyncSchedule, input: {
  now: number; mode: string; reason: AutomaticSyncReason; visible: boolean; readyWrites: boolean;
}): boolean {
  if (input.mode === 'manual' || state.retryAfter > input.now) return false;
  // A hidden authorized tab can still deliver another tab's saved edits.
  if (input.readyWrites) return true;
  if (!input.visible || input.reason === 'local-mutation' || input.reason === 'workspace-change') return false;
  const interval = input.reason === 'interval' ? (input.mode === 'near-real-time' ? 30_000 : 300_000) : 10_000;
  return !state.attemptedAt || input.now - Math.max(state.attemptedAt, state.finishedAt) >= interval;
}

export function beginSyncAttempt(previous: SyncSchedule, now: number, explicit = false): SyncSchedule {
  return { ...previous, attemptedAt: now, ...(explicit ? { failures: 0, retryAfter: 0 } : {}) };
}

export function finishSyncAttempt(previous: SyncSchedule, now: number, succeeded: boolean, random = Math.random()): SyncSchedule {
  const failures = succeeded ? 0 : Math.min(10, previous.failures + 1);
  const delay = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5) * (0.8 + 0.4 * random));
  return { ...previous, finishedAt: now, failures, retryAfter: succeeded ? 0 : now + Math.round(delay) };
}
