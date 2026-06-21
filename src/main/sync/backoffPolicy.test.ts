import { describe, expect, it } from "vitest";
import { GoogleApiError } from "../google";
import { backoffConstraintMultiplier, SyncBackoffPolicy } from "./backoffPolicy";

describe("SyncBackoffPolicy", () => {
  it("applies low-power and constrained-network multipliers", () => {
    expect(backoffConstraintMultiplier({})).toBe(1);
    expect(backoffConstraintMultiplier({ lowPowerMode: true })).toBe(1.5);
    expect(backoffConstraintMultiplier({ constrainedNetwork: true })).toBe(2);
    expect(backoffConstraintMultiplier({ lowPowerMode: true, constrainedNetwork: true })).toBe(3);
  });

  it("multiplies exponential retry delays under constrained environments", () => {
    const policy = new SyncBackoffPolicy({
      baseDelayMs: 1_000,
      jitterMs: 200,
      random: () => 0.5,
      constraintState: () => ({ lowPowerMode: true, constrainedNetwork: true })
    });

    expect(policy.delayMsForAttempt(1)).toBe(6_300);
  });

  it("multiplies retry-after delays under constrained environments", () => {
    const policy = new SyncBackoffPolicy({
      constraintState: () => ({ constrainedNetwork: true })
    });

    expect(policy.retryDelayMs(
      new GoogleApiError({
        kind: "server",
        status: 503,
        message: "server unavailable",
        retryAfterMs: 10_000
      }),
      0
    )).toBe(20_000);
  });
});
