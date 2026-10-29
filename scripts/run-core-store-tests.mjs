import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const testDatabaseRoot = mkdtempSync(join(tmpdir(), "hcb-test-db-run-"));

try {
  console.log(`HCB CoreStore test database root: ${testDatabaseRoot}`);
  const result = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.ts", "src/main/services/coreStore.test.ts", "src/main/services/coreStore.migration.test.ts", "src/main/services/googleSync.integration.test.ts", "src/main/services/googleSyncState.test.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HCB_TEST_DATABASE_ROOT: testDatabaseRoot,
        NODE_ENV: "test"
      },
      stdio: "inherit"
    }
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  // This owns only the per-run temporary directory it created above.
  rmSync(testDatabaseRoot, { recursive: true, force: true });
}
