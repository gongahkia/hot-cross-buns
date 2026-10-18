import { describe, expect, it } from "vitest";
import { taskOrderBetween } from "./taskOrder";

describe("task ordering", () => {
  it("inserts between Google position strings and handles repeated prepends and appends", () => {
    const keys = ["00000000000000000001", "00000000000000000002"];
    for (let index = 0; index < 1000; index += 1) {
      const middle = taskOrderBetween(keys[0], keys[1]);
      expect(middle).not.toBeNull();
      expect(middle! > keys[0] && middle! < keys[1]).toBe(true);
      keys.splice(1, 0, middle!);
    }
    let first: string | null = "000000000000";
    let last: string | null = "999999999999";
    for (let index = 0; index < 1000; index += 1) {
      const before = taskOrderBetween(null, first), after = taskOrderBetween(last, null);
      expect(before).not.toBeNull(); expect(after).not.toBeNull();
      expect(before! < first!).toBe(true); expect(after! > last!).toBe(true);
      first = before; last = after;
    }
  });
});
