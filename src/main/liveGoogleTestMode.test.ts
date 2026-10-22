import { describe, expect, it } from "vitest";
import { isLiveGoogleReadOnlyTest, isLiveGoogleTest, liveGoogleTestMode } from "./liveGoogleTestMode";

describe("live Google test mode", () => {
  it("only enables the two explicit modes", () => {
    expect(liveGoogleTestMode({})).toBeNull();
    expect(liveGoogleTestMode({ HCB_LIVE_GOOGLE_TEST_MODE: "read-only" })).toBe("read-only");
    expect(liveGoogleTestMode({ HCB_LIVE_GOOGLE_TEST_MODE: "mutating" })).toBe("mutating");
    expect(liveGoogleTestMode({ HCB_LIVE_GOOGLE_TEST_MODE: "true" })).toBeNull();
  });

  it("recognizes the read-only guard only for read-only mode", () => {
    expect(isLiveGoogleTest({ HCB_LIVE_GOOGLE_TEST_MODE: "mutating" })).toBe(true);
    expect(isLiveGoogleReadOnlyTest({ HCB_LIVE_GOOGLE_TEST_MODE: "read-only" })).toBe(true);
    expect(isLiveGoogleReadOnlyTest({ HCB_LIVE_GOOGLE_TEST_MODE: "mutating" })).toBe(false);
  });
});
