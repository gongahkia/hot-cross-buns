import { beforeEach, describe, expect, it } from "vitest";

import { LocalStore } from "@/data/localStore";
import { buildDiagnostics } from "@/features/diagnostics";

describe("diagnostics export", () => {
  beforeEach(async () => {
    await new LocalStore().clearAll();
  });

  it("exports counts and capabilities without browser-local Google content or credentials", async () => {
    const store = new LocalStore();
    await store.saveSnapshot({
      identity: { subject: "sensitive-subject", email: "person@example.test" },
      taskLists: [{ id: "list", title: "Private list" }],
      tasks: [{ id: "task", listId: "list", title: "Confidential task", notes: "token-like secret", status: "needsAction" }],
      calendars: [], events: [], updatedAt: "2026-08-17T00:00:00.000Z"
    });
    const snapshot = await buildDiagnostics("sensitive-subject", { active: false, cancellable: false, phase: "idle", detail: "idle", pagesSaved: 0, recordsSaved: 0 });
    const json = JSON.stringify(snapshot);
    expect(snapshot.cache.tasks).toBe(1);
    expect(json).not.toContain("sensitive-subject");
    expect(json).not.toContain("person@example.test");
    expect(json).not.toContain("Confidential task");
    expect(json).not.toContain("token-like secret");
  });
});
