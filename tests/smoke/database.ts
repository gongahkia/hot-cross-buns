import type { ElectronApplication } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

/** Seed provider state without introducing a test-only application IPC route. */
export async function seedDatabase(app: ElectronApplication, statements: Array<{ sql: string; values?: unknown[] }>) {
  const profile = await app.evaluate(({ app }) => app.getPath("userData"));
  if (!basename(profile).startsWith("hcb-workspace-ui-")) throw new Error("Expected an isolated UI-test profile");
  // better-sqlite3 uses Electron's ABI, so run the fixture writer under Electron too.
  execFileSync(require("electron"), ["-e", `
    const Database = require(process.argv[1]);
    const db = new Database(process.argv[2]);
    try {
      const statements = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
      db.transaction(() => { for (const { sql, values = [] } of statements) db.prepare(sql).run(...values); })();
    } finally { db.close(); }
  `, resolve("node_modules/better-sqlite3"), join(profile, "hcb.sqlite")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, input: JSON.stringify(statements), timeout: 10_000
  });
}
