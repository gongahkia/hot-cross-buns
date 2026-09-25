import { describe, expect, it, vi } from "vitest";
import { GoogleSyncService } from "./googleSync";

function createService(): {
  deliverOutbox: ReturnType<typeof vi.fn>;
  pullGoogleCalendars: ReturnType<typeof vi.fn>;
  pullGoogleTasks: ReturnType<typeof vi.fn>;
  service: GoogleSyncService;
} {
  const store = {
    googleAccounts: () => [{ accountId: "test-account", connectionState: "connected" }],
    pendingSyncMutations: () => [],
    setSyncRuntime: vi.fn()
  };
  const oauth = { onConnectionChange: vi.fn() };
  const service = new GoogleSyncService(store as never, oauth as never);
  const internals = service as unknown as {
    deliverOutbox: ReturnType<typeof vi.fn>;
    pullGoogleCalendars: ReturnType<typeof vi.fn>;
    pullGoogleTasks: ReturnType<typeof vi.fn>;
  };

  internals.pullGoogleTasks = vi.fn(async () => undefined);
  internals.pullGoogleCalendars = vi.fn(async () => undefined);
  internals.deliverOutbox = vi.fn(async () => undefined);
  return { ...internals, service };
}

describe("GoogleSyncService", () => {
  it("pulls without draining the outbox in read-only mode", async () => {
    const { deliverOutbox, pullGoogleCalendars, pullGoogleTasks, service } = createService();

    await service.runNow({ accountId: "test-account", readOnly: true });

    expect(pullGoogleTasks).toHaveBeenCalledTimes(1);
    expect(pullGoogleCalendars).toHaveBeenCalledTimes(1);
    expect(deliverOutbox).not.toHaveBeenCalled();
  });

  it("keeps the normal pull-deliver-pull cycle outside read-only mode", async () => {
    const { deliverOutbox, pullGoogleCalendars, pullGoogleTasks, service } = createService();

    await service.runNow({ accountId: "test-account" });

    expect(pullGoogleTasks).toHaveBeenCalledTimes(2);
    expect(pullGoogleCalendars).toHaveBeenCalledTimes(2);
    expect(deliverOutbox).toHaveBeenCalledWith("test-account");
  });
});
