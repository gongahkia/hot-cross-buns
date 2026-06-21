import { describe, expect, it } from "vitest";
import {
  packagedUserDataDirectoryOverrideEnvKey,
  resolveUserDataDirectoryOverride,
  userDataDirectoryEnvKey
} from "./userDataOverride";

describe("resolveUserDataDirectoryOverride", () => {
  it("allows absolute development overrides", () => {
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: "/tmp/hcb2-dev" }, false)).toBe("/tmp/hcb2-dev");
  });

  it("ignores empty and relative overrides", () => {
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: " " }, false)).toBeNull();
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: "tmp/hcb2-dev" }, false)).toBeNull();
  });

  it("ignores packaged overrides unless explicitly enabled", () => {
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: "/tmp/hcb2-packaged" }, true)).toBeNull();
  });

  it("allows packaged overrides behind the explicit QA flag", () => {
    expect(resolveUserDataDirectoryOverride({
      [packagedUserDataDirectoryOverrideEnvKey]: "1",
      [userDataDirectoryEnvKey]: "/tmp/hcb2-packaged"
    }, true)).toBe("/tmp/hcb2-packaged");
  });

  it("accepts Windows absolute paths from non-Windows hosts", () => {
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: "C:\\Users\\qa\\AppData\\Local\\hcb2" }, false))
      .toBe("C:\\Users\\qa\\AppData\\Local\\hcb2");
  });
});
