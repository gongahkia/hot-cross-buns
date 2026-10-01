import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

export const testDatabaseRootEnvironmentVariable = "HCB_TEST_DATABASE_ROOT";

type Environment = Record<string, string | undefined>;

/**
 * Test processes must opt into an explicit, disposable database root.  This is
 * deliberately enforced in the CoreStore constructor as a last line of
 * defence: an Electron or Vitest test must never silently use the developer
 * profile just because its caller omitted a `--user-data-dir` argument.
 */
export function assertIsolatedTestDatabasePath(
  databasePath: string,
  environment: Environment = process.env
): void {
  if (environment.NODE_ENV !== "test") return;

  const configuredRoot = environment[testDatabaseRootEnvironmentVariable];
  if (!configuredRoot || !isAbsolute(configuredRoot)) {
    throw new Error(
      `Test database isolation requires an absolute ${testDatabaseRootEnvironmentVariable}. Refusing to open ${databasePath}.`
    );
  }

  const root = resolve(configuredRoot);
  const target = resolve(databasePath);
  if (!environment.HCB_LIVE_GOOGLE_TEST_MODE && !isWithin(tmpdir(), root)) {
    throw new Error(
      `Test database isolation requires ${testDatabaseRootEnvironmentVariable} to be inside the OS temporary directory. Refusing ${root}.`
    );
  }
  if (!isWithin(root, target)) {
    throw new Error(
      `Refusing to open ${target} from a test process because it is outside ${testDatabaseRootEnvironmentVariable} (${root}).`
    );
  }
}

export function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(target));
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}
