import { describe, expect, it } from "vitest";
import {
  packagedUserDataDirectoryOverrideEnvKey,
  resolveUserDataDirectoryOverride,
  userDataDirectoryEnvKey
} from "./userDataOverride";

describe("resolveUserDataDirectoryOverride", () => {
  it("allows absolute development overrides", () => {
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: "/tmp/hcb-dev" }, false)).toBe("/tmp/hcb-dev");
  });

  it("ignores empty and relative overrides", () => {
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: " " }, false)).toBeNull();
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: "tmp/hcb-dev" }, false)).toBeNull();
  });

  it("ignores packaged overrides unless explicitly enabled", () => {
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: "/tmp/hcb-packaged" }, true)).toBeNull();
  });

  it("allows packaged overrides behind the explicit QA flag", () => {
    expect(resolveUserDataDirectoryOverride({
      [packagedUserDataDirectoryOverrideEnvKey]: "1",
      [userDataDirectoryEnvKey]: "/tmp/hcb-packaged"
    }, true)).toBe("/tmp/hcb-packaged");
  });

  it("accepts Windows absolute paths from non-Windows hosts", () => {
    expect(resolveUserDataDirectoryOverride({ [userDataDirectoryEnvKey]: "C:\\Users\\qa\\AppData\\Local\\hcb" }, false))
      .toBe("C:\\Users\\qa\\AppData\\Local\\hcb");
  });
});
