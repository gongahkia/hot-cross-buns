import { describe, expect, it } from 'vitest';
import { beginSyncAttempt, finishSyncAttempt, readSyncSchedule, shouldSyncAutomatically } from './syncSchedule';

const now = 1_000_000;
const idle = readSyncSchedule(null, now);
const input = { now, mode: 'balanced', reason: 'foreground' as const, visible: true, readyWrites: false };

describe('automatic Google scheduling policy', () => {
  it('catches up on return while suppressing focus bursts and respecting the polling mode', () => {
    const completed = finishSyncAttempt(beginSyncAttempt(idle, now), now + 100, true);
    expect(shouldSyncAutomatically(idle, input)).toBe(true);
    expect(shouldSyncAutomatically(completed, { ...input, now: now + 9_999 })).toBe(false);
    expect(shouldSyncAutomatically(completed, { ...input, now: now + 10_100 })).toBe(true);
    expect(shouldSyncAutomatically(completed, { ...input, reason: 'interval', now: now + 30_100 })).toBe(false);
    expect(shouldSyncAutomatically(completed, { ...input, reason: 'interval', mode: 'near-real-time', now: now + 30_100 })).toBe(true);
    expect(shouldSyncAutomatically(completed, { ...input, reason: 'interval', now: now + 300_100 })).toBe(true);
  });

  it('flushes ready writes from a hidden tab without repeatedly downloading an unchanged workspace', () => {
    expect(shouldSyncAutomatically(idle, { ...input, visible: false })).toBe(false);
    expect(shouldSyncAutomatically(idle, { ...input, reason: 'workspace-change' })).toBe(false);
    expect(shouldSyncAutomatically(idle, { ...input, visible: false, reason: 'workspace-change', readyWrites: true })).toBe(true);
    expect(shouldSyncAutomatically(idle, { ...input, mode: 'manual', readyWrites: true })).toBe(false);
  });

  it('backs off failed pulls even with pending writes and allows explicit retry to reset the cooldown', () => {
    let state = beginSyncAttempt(idle, now);
    state = finishSyncAttempt(state, now, false, 0.5);
    expect(state.retryAfter).toBe(now + 30_000);
    expect(shouldSyncAutomatically(state, { ...input, reason: 'online', readyWrites: true })).toBe(false);
    const explicit = beginSyncAttempt(state, now + 1, true);
    expect(explicit).toMatchObject({ failures: 0, retryAfter: 0 });
    for (let attempt = 0; attempt < 20; attempt++) state = finishSyncAttempt(state, now, false, 1);
    expect(state).toMatchObject({ failures: 10, retryAfter: now + 900_000 });
    expect(finishSyncAttempt(state, now + 1, true)).toMatchObject({ failures: 0, retryAfter: 0 });
  });

  it('recovers from backwards clock changes and malformed or future imported metadata', () => {
    expect(readSyncSchedule({ attemptedAt: now + 1, finishedAt: 0, failures: 2, retryAfter: now + 60_000 }, now)).toEqual(idle);
    expect(readSyncSchedule({ attemptedAt: now, finishedAt: 0, failures: 2, retryAfter: now + 999_999_999 }, now)).toEqual(idle);
    expect(readSyncSchedule({ attemptedAt: 'yesterday' }, now)).toEqual(idle);
    const valid = finishSyncAttempt(beginSyncAttempt(idle, now), now, false, 0.5);
    expect(readSyncSchedule(valid, now)).toEqual(valid);
  });
});
