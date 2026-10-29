import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeSyncLifecycle } from './syncLifecycle';

let stop: (() => void) | undefined;
let visibility: DocumentVisibilityState;
beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('browser sync lifecycle', () => {
  it('coalesces focus, visibility and page restoration into one catch-up request', () => {
    const send = vi.fn(); stop = observeSyncLifecycle(send); send.mockClear();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(250);
    expect(send.mock.calls.filter(([event]) => event.reason)).toEqual([[{ type: 'sync-lifecycle', visible: true, reason: 'foreground' }]]);
  });

  it('reports backgrounding immediately and cancels a queued foreground pull', () => {
    const send = vi.fn(); stop = observeSyncLifecycle(send); send.mockClear();
    window.dispatchEvent(new Event('focus'));
    visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(1_000);
    expect(send.mock.calls).toEqual([[{ type: 'sync-lifecycle', visible: false }]]);
  });

  it('retains an online hint in a hidden tab so the worker can flush saved edits', () => {
    const send = vi.fn(); stop = observeSyncLifecycle(send); send.mockClear();
    visibility = 'hidden';
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(250);
    expect(send.mock.calls).toEqual([[{ type: 'sync-lifecycle', visible: false, reason: 'online' }]]);
  });

  it('stops pending work and listeners after a worker failure', () => {
    const send = vi.fn(); stop = observeSyncLifecycle(send); send.mockClear();
    window.dispatchEvent(new Event('online')); stop();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(1_000);
    expect(send).not.toHaveBeenCalled();
  });
});
