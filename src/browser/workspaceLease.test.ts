import { describe, expect, it } from 'vitest';
import { WorkspaceLease } from './workspaceLease';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function locks() {
  let queue = Promise.resolve();
  return { request: (_name: string, _options: unknown, action: () => Promise<void>) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  } } as unknown as LockManager;
}

describe('workspace lease during remote waits', () => {
  it('lets a local writer commit while a response body is still streaming, then reloads before applying its receipt', async () => {
    const manager = locks(), sync = new WorkspaceLease(manager, 'writer'), local = new WorkspaceLease(manager, 'writer');
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(stream) { controller = stream; } }));
    let durable = 1, loaded = 1;
    const started = deferred<void>();
    await sync.acquire();
    const receipt = sync.outside(async () => { started.resolve(); return response.json(); }, async () => { durable = 2; }, async () => { loaded = durable; });
    await started.promise;
    await local.acquire(); durable = 3; await local.release();
    controller.enqueue(new TextEncoder().encode('{"accepted":true}')); controller.close();
    expect(await receipt).toEqual({ accepted: true });
    expect(loaded).toBe(3);
    await sync.release();
  });

  it('reloads a newer local commit before recording a failed HTTP request', async () => {
    const manager = locks(), sync = new WorkspaceLease(manager, 'writer'), local = new WorkspaceLease(manager, 'writer');
    const http = deferred<void>(), started = deferred<void>();
    let saved = 'before', loaded = saved;
    await sync.acquire();
    const receipt = sync.outside(() => { started.resolve(); return http.promise; }, async () => {}, async () => { loaded = saved; });
    const outcome = expect(receipt).rejects.toThrow('network failed');
    await started.promise;
    await local.acquire(); saved = 'local edit'; await local.release();
    http.reject(new Error('network failed')); await outcome;
    expect(loaded).toBe('local edit');
    await sync.release();
    await local.acquire(); await local.release();
  });

  it('never sends HTTP if the intent cannot be persisted', async () => {
    const lease = new WorkspaceLease(locks(), 'writer');
    let sent = false;
    await lease.acquire();
    await expect(lease.outside(async () => { sent = true; }, async () => { throw new Error('storage full'); }, async () => {})).rejects.toThrow('storage full');
    expect(sent).toBe(false);
    await lease.release();
  });
});
