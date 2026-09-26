import { describe, expect, it } from "vitest";
import { sidebarDrawerSnapTarget, sidebarDrawerSnapThreshold } from "./sidebarDrawerDrag";

describe("sidebarDrawerSnapTarget", () => {
  it("collapses an open left drawer only after an outward drag", () => {
    expect(sidebarDrawerSnapTarget({ deltaX: -sidebarDrawerSnapThreshold + 1, sidebarOnRight: false, sidebarOpen: true })).toBeNull();
    expect(sidebarDrawerSnapTarget({ deltaX: -sidebarDrawerSnapThreshold, sidebarOnRight: false, sidebarOpen: true })).toBe(false);
    expect(sidebarDrawerSnapTarget({ deltaX: sidebarDrawerSnapThreshold, sidebarOnRight: false, sidebarOpen: true })).toBeNull();
  });

  it("expands a collapsed left drawer only after an inward drag", () => {
    expect(sidebarDrawerSnapTarget({ deltaX: sidebarDrawerSnapThreshold - 1, sidebarOnRight: false, sidebarOpen: false })).toBeNull();
    expect(sidebarDrawerSnapTarget({ deltaX: sidebarDrawerSnapThreshold, sidebarOnRight: false, sidebarOpen: false })).toBe(true);
  });

  it("mirrors drag directions for a right drawer", () => {
    expect(sidebarDrawerSnapTarget({ deltaX: sidebarDrawerSnapThreshold, sidebarOnRight: true, sidebarOpen: true })).toBe(false);
    expect(sidebarDrawerSnapTarget({ deltaX: -sidebarDrawerSnapThreshold, sidebarOnRight: true, sidebarOpen: false })).toBe(true);
  });
});
