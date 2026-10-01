import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const testDatabaseRoot = mkdtempSync(join(tmpdir(), "hcb-test-db-run-"));

try {
  console.log(`HCB CoreStore test database root: ${testDatabaseRoot}`);
  const result = spawnSync(
    electronBinary,
    ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.ts", "src/main/services/coreStore.test.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
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
