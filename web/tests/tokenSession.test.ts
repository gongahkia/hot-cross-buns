import { describe, expect, it, vi } from "vitest";

import { TokenSession } from "@/auth/tokenSession";

describe("TokenSession", () => {
  it("keeps a token only while it remains valid in memory", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const session = new TokenSession();
    session.set({ value: "access-token", expiresAt: 2_000, scopes: ["scope-a"] });

    expect(session.accessToken()).toBe("access-token");
    expect(session.hasScope("scope-a")).toBe(true);

    now.mockReturnValue(2_000);
    expect(session.accessToken()).toBeUndefined();
    session.clear();
    expect(session.current()).toBeUndefined();
    now.mockRestore();
  });
});
