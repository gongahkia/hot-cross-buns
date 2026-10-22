import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  assertIsolatedTestDatabasePath,
  isWithin,
  testDatabaseRootEnvironmentVariable
} from "./testDatabasePaths";

const isolatedEnvironment = {
  NODE_ENV: "test",
  [testDatabaseRootEnvironmentVariable]: join(tmpdir(), "hcb-test-run")
};

describe("test database isolation", () => {
  it("accepts filesystem aliases but rejects symlinks escaping the disposable root", () => {
    const directory = mkdtempSync(join(tmpdir(), "hcb-isolation-alias-"));
    try {
      const root = join(directory, "allowed");
      const outside = join(directory, "outside");
      const alias = join(directory, "alias");
      mkdirSync(root); mkdirSync(outside);
      const type = process.platform === "win32" ? "junction" : "dir";
      symlinkSync(root, alias, type);
      symlinkSync(outside, join(root, "escape"), type);
      const environment = { NODE_ENV: "test", [testDatabaseRootEnvironmentVariable]: alias };
      expect(() => assertIsolatedTestDatabasePath(join(realpathSync(root), "not-created-yet/hcb.sqlite"), environment)).not.toThrow();
      expect(() => assertIsolatedTestDatabasePath(join(alias, "escape/hcb.sqlite"), environment)).toThrow("outside");
      expect(isWithin(root, join(root, "escape/hcb.sqlite"))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts only a database inside the explicit disposable root", () => {
    expect(() => assertIsolatedTestDatabasePath(
      join(tmpdir(), "hcb-test-run/core-store-a/hcb.sqlite"),
      isolatedEnvironment
    )).not.toThrow();
    expect(isWithin(join(tmpdir(), "hcb-test-run"), join(tmpdir(), "hcb-test-run/core-store-b/hcb.sqlite"))).toBe(true);
  });

  it("fails loudly instead of falling back to a user or development profile", () => {
    expect(() => assertIsolatedTestDatabasePath(
      "/Users/example/Library/Application Support/hot-cross-buns/hcb.sqlite",
      { NODE_ENV: "test" }
    )).toThrow(testDatabaseRootEnvironmentVariable);
    expect(() => assertIsolatedTestDatabasePath(
      "/Users/example/Library/Application Support/hot-cross-buns/hcb.sqlite",
      isolatedEnvironment
    )).toThrow("outside");
    expect(() => assertIsolatedTestDatabasePath(
      "/Users/example/Library/Application Support/hot-cross-buns/hcb.sqlite",
      {
        NODE_ENV: "test",
        [testDatabaseRootEnvironmentVariable]: "/Users/example/Library/Application Support/hot-cross-buns"
      }
    )).toThrow("temporary directory");
  });

  it("does not constrain normal application processes", () => {
    expect(() => assertIsolatedTestDatabasePath(
      "/Users/example/Library/Application Support/hot-cross-buns/hcb.sqlite",
      { NODE_ENV: "development" }
    )).not.toThrow();
  });
});
