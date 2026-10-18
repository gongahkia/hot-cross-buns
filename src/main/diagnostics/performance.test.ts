import { describe, expect, it } from "vitest";
import { recordTiming, timingSnapshot } from "./performance";

describe("Performance samples", () => {
  it("rejects invalid measurements and bounds retained samples", () => {
    expect(recordTiming({ name: "invalid", kind: "ipc", durationMs: Infinity })).toBe(false);
    expect(recordTiming({ name: "invalid", kind: "ipc", durationMs: -1 })).toBe(false);
    for (let index = 0; index < 500; index += 1) recordTiming({ name: `query.${index}`, kind: "sqlite_query", durationMs: index });
    const snapshot = timingSnapshot();
    expect(snapshot).toHaveLength(200);
    expect(snapshot.at(-1)?.name).toBe("query.499");
    snapshot[0].name = "changed";
    expect(timingSnapshot()[0].name).toBe("query.300");
  });
});
