import { describe, expect, it, vi } from "vitest";
import { recordTiming, timedAsync, timingSnapshot } from "./performance";

describe("Performance samples", () => {
  it("measures asynchronous completion without retaining returned data or errors", async () => {
    let now = 10;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const secret = { accessToken: 'sensitive-token', notes: 'private note' };
      expect(await timedAsync('google.http.read', 'sync', async () => { now = 35; return secret; })).toBe(secret);
      const failure = new Error('private response body');
      await expect(timedAsync('google.http.write', 'sync', async () => { now = 85; throw failure; })).rejects.toBe(failure);
      expect(timingSnapshot().slice(-2).map(({ recordedAt: _at, ...sample }) => sample)).toEqual([
        { name: 'google.http.read', kind: 'sync', durationMs: 25 },
        { name: 'google.http.write', kind: 'sync', durationMs: 50 },
      ]);
      expect(JSON.stringify(timingSnapshot())).not.toMatch(/sensitive-token|private note|private response body/);
    } finally { clock.mockRestore(); }
  });
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
