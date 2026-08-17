import { describe, expect, it } from "vitest";

import { formatBinding, normalizedBinding } from "@/features/keybindings";

describe("keybindings", () => {
  it("normalizes persisted shortcuts and renders macOS key labels", () => {
    expect(normalizedBinding("shift + meta + k")).toBe("Meta+Shift+K");
    expect(formatBinding("Meta+Shift+K")).toBe("⌘ ⇧ K");
  });
});
