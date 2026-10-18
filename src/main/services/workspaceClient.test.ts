import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ workers: [] as any[] }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWorker extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => { this.emit("exit", 1); return 1; });
    constructor() { super(); state.workers.push(this); }
  }
  return { Worker: FakeWorker, default: { Worker: FakeWorker } };
});
vi.mock("electron", () => ({ safeStorage: {}, shell: {}, default: { safeStorage: {}, shell: {} } }));
import { WorkspaceClient } from "./workspaceClient";

afterEach(() => { state.workers.length = 0; vi.useRealTimers(); });

describe("workspace worker lifecycle", () => {
  it("rejects requests and future calls after an unexpected clean exit", async () => {
    const client = new WorkspaceClient("/tmp/hcb-worker-test");
    const worker = state.workers[0];
    worker.emit("message", { kind: "ready", snapshot: { settings: {} } });
    await client.ready;
    const pending = client.core.dispatch("tasks", "list", {});
    await Promise.resolve();
    worker.emit("exit", 0);
    await expect(pending).rejects.toThrow("workspace worker stopped");
    await expect(client.core.dispatch("tasks", "list", {})).rejects.toThrow("workspace worker stopped");
    await client.close();
  });

  it("bounds shutdown even if startup never becomes ready", async () => {
    vi.useFakeTimers();
    const client = new WorkspaceClient("/tmp/hcb-worker-test");
    const worker = state.workers[0];
    const closing = client.close();
    expect(client.close()).toBe(closing);
    await expect(client.core.dispatch("tasks", "list", {})).rejects.toThrow("closing");
    await vi.advanceTimersByTimeAsync(2000);
    await closing;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("finishes graceful shutdown without waiting for the deadline", async () => {
    const client = new WorkspaceClient("/tmp/hcb-worker-test");
    const worker = state.workers[0];
    const closing = client.close();
    worker.emit("message", { kind: "closed" });
    await closing;
    expect(worker.postMessage).toHaveBeenCalledWith({ kind: "close" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
