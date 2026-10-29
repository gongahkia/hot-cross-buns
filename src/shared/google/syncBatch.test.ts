import { describe, expect, it } from "vitest";
import type { PendingSyncMutation } from "../core/CoreStore";
import { compatibleGoogleBatch } from "./syncBatch";

const mutation = (id: string, changes: Partial<PendingSyncMutation> = {}): PendingSyncMutation => ({
  id, accountId: "account", kind: "task.update", entityId: "task", payload: {}, attempts: 0, createdAt: "2026-10-29",
  intent: { snapshot: { id: "task" }, changedFields: ["title"], barrier: false }, ...changes
});

describe("ordered outgoing batches", () => {
  it("combines adjacent compatible updates without mutating their individual records", () => {
    const ready = [mutation("a"), mutation("b"), mutation("c")];
    expect(compatibleGoogleBatch(ready, "a").map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(ready).toHaveLength(3);
  });
  it("folds unsent updates into a creation", () => {
    expect(compatibleGoogleBatch([mutation("create", { kind: "task.create" }), mutation("edit")], "create")).toHaveLength(2);
  });
  it.each([
    { entityId: "other" }, { accountId: "other" }, { kind: "task.delete" }, { kind: "event.move" },
    { attempts: 1 }, { intent: null }, { kind: "task.create" },
    { intent: { snapshot: {}, changedFields: [], barrier: true } }
  ])("stops at a barrier without collecting a later compatible write: %j", (barrier) => {
    expect(compatibleGoogleBatch([mutation("a"), mutation("barrier", barrier), mutation("b")], "a").map((item) => item.id)).toEqual(["a"]);
  });
  it.each([{ attempts: 1 }, { intent: null }, { intent: { snapshot: {}, changedFields: [], barrier: true } }])("does not append to an unsafe first command: %j", (change) => {
    expect(compatibleGoogleBatch([mutation("a", change), mutation("b")], "a")).toHaveLength(1);
  });
  it("does not deliver a command that is no longer eligible", () => {
    expect(compatibleGoogleBatch([mutation("b")], "a")).toEqual([]);
  });
});
