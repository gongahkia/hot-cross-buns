import { describe, expect, it } from "vitest";
import {
  PlannerConflictError,
  PlannerDeliveryError,
  PlannerStore,
  type PlannerPersistence
} from "./plannerStore";

class MemoryPersistence implements PlannerPersistence {
  value: unknown | null = null;
  writes = 0;

  async read(): Promise<unknown | null> {
    return this.value;
  }

  async write(state: unknown): Promise<void> {
    this.value = structuredClone(state);
    this.writes += 1;
  }
}

function createStore(persistence = new MemoryPersistence()) {
  let clock = new Date("2026-09-25T00:00:00.000Z");
  const store = new PlannerStore({
    persistence,
    now: () => clock,
    random: () => 0
  });

  return {
    store,
    persistence,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    }
  };
}

const key = (suffix: string) => `idempotency-key-${suffix.padEnd(20, "x")}`;

describe("PlannerStore", () => {
  it("commits an optimistic change and its durable outbox receipt together", async () => {
    const { store, persistence } = createStore();
    const first = await store.saveTask({
      title: "Ship Electron revival",
      notes: "Keep the historical HCB lineages",
      dueDate: "2026-10-01",
      idempotencyKey: key("save")
    });
    const replay = await store.saveTask({
      title: "Ship Electron revival",
      notes: "Keep the historical HCB lineages",
      dueDate: "2026-10-01",
      idempotencyKey: key("save")
    });

    expect(replay).toEqual(first);
    expect((await store.workspace()).pendingMutationCount).toBe(1);
    expect(persistence.writes).toBe(1);
  });

  it("rejects an idempotency-key reuse with a different operation", async () => {
    const { store } = createStore();
    await store.saveTask({
      title: "First title",
      notes: "",
      dueDate: null,
      idempotencyKey: key("conflict")
    });

    await expect(
      store.saveTask({
        title: "Different title",
        notes: "",
        dueDate: null,
        idempotencyKey: key("conflict")
      })
    ).rejects.toBeInstanceOf(PlannerConflictError);
  });

  it("uses revisioned opaque cursors so stale pages cannot silently reorder", async () => {
    const { store } = createStore();
    await store.saveTask({ title: "Alpha", notes: "", dueDate: null, idempotencyKey: key("alpha") });
    await store.saveTask({ title: "Beta", notes: "", dueDate: null, idempotencyKey: key("beta") });

    const page = await store.listTasks({ query: "", limit: 1 });
    expect(page.nextCursor).not.toBeNull();

    await store.saveTask({ title: "Gamma", notes: "", dueDate: null, idempotencyKey: key("gamma") });

    await expect(
      store.listTasks({ query: "", limit: 1, cursor: page.nextCursor ?? undefined })
    ).rejects.toBeInstanceOf(PlannerConflictError);
  });

  it("keeps ordered mutations after retryable delivery failures and applies bounded backoff", async () => {
    const { store, advance } = createStore();
    await store.saveTask({ title: "First", notes: "", dueDate: null, idempotencyKey: key("first") });
    await store.saveTask({ title: "Second", notes: "", dueDate: null, idempotencyKey: key("second") });

    const deferred = await store.flushOutbox({
      deliver: async () => {
        throw new PlannerDeliveryError("offline", true);
      }
    });
    expect(deferred).toEqual({ delivered: 0, deferred: 1, conflicts: 0 });
    expect((await store.syncStatus()).pendingMutationCount).toBe(2);

    advance(2_000);
    const calls: string[] = [];
    const flushed = await store.flushOutbox({
      deliver: async (item) => {
        calls.push(item.taskId);
      }
    });

    expect(flushed).toEqual({ delivered: 2, deferred: 0, conflicts: 0 });
    expect(calls).toHaveLength(2);
    expect((await store.syncStatus()).pendingMutationCount).toBe(0);
  });

  it("preserves non-retryable deliveries as visible conflicts", async () => {
    const { store } = createStore();
    await store.saveTask({ title: "Needs review", notes: "", dueDate: null, idempotencyKey: key("review") });

    await expect(
      store.flushOutbox({
        deliver: async () => {
          throw new PlannerDeliveryError("precondition failed", false);
        }
      })
    ).resolves.toEqual({ delivered: 0, deferred: 0, conflicts: 1 });

    expect((await store.syncStatus()).conflictCount).toBe(1);
  });
});
