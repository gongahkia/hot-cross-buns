import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ shown: [] as any[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    show = vi.fn(() => { state.shown.push(this); this.emit("show"); });
    close = vi.fn(() => this.emit("close"));
  }
  return { Notification, default: { Notification } };
});
import { ElectronNotificationScheduler } from "./electronNotificationScheduler";

afterEach(() => { vi.useRealTimers(); state.shown.length = 0; });
describe("notification delivery history", () => {
  it("does not redeliver the same reminder after a schedule refresh", async () => {
    vi.useFakeTimers();
    const scheduler = new ElectronNotificationScheduler("linux", "linux");
    const request = { id: "task:one:2026-10-18", title: "Task due", body: "Reminder", deliveryDate: new Date(Date.now() + 1000) };
    const first = scheduler.schedule(request, () => undefined)!;
    expect(first.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.state).toBe("delivered");
    scheduler.clear();
    const repeated = scheduler.schedule({ ...request, deliveryDate: new Date(Date.now() + 1000) }, () => undefined)!;
    expect(repeated.state).toBe("delivered");
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.shown).toHaveLength(1);
    scheduler.schedule({ ...request, id: "task:one:2026-10-19", deliveryDate: new Date(Date.now() + 1000) }, () => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.shown).toHaveLength(2);
    scheduler.clear();
  });
});
