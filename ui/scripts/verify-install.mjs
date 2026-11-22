import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, lstat, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { acquireUpdateGuard } from "../../app-host/src/update-guard.mjs";
const artifact = resolve(process.argv[2]);
const directory = await mkdtemp(join(tmpdir(), "hot-cross-buns-install-check-"));
const prefix = join(directory, "prefix"), workspace = join(directory, "workspace");
await mkdir(workspace);
const env = { ...process.env, HOT_CROSS_BUNS_STATE_DIR: join(directory, "state"), HOT_CROSS_BUNS_CONFIG_DIR: join(directory, "config"), HOT_CROSS_BUNS_TERMINAL_USER_DATA: join(directory, "app") };
function run(command, args, success = true, selectedEnv = env, timeout = 30000) {
  const result = spawnSync(command, args, { env: selectedEnv, cwd: workspace, encoding: "utf8", timeout });
  if (success) assert.equal(result.status, 0, result.stderr || result.error?.message);
  else assert.notEqual(result.status, 0);
  return result;
}
try {
  // Copying the complete dependency tree on a cold Windows runner can exceed
  // the command-smoke timeout. Keep the copy bounded independently of checks.
  run(process.execPath, [resolve("ui/scripts/install.mjs"), artifact, prefix], true, env, process.platform === "win32" ? 120000 : 30000);
  const launcher = join(prefix, "lib/hot-cross-buns-terminal/bin/hot-cross-buns");
  assert.match(run("bun", [launcher, "--version"]).stdout, /hot-cross-buns terminal/);
  run("bun", [launcher, "note", "add", "--title", "Preserved install fixture", "--body", "Private data survives removal."]);
  const publicLauncher = join(prefix, "bin", process.platform === "win32" ? "hot-cross-buns.cmd" : "hot-cross-buns");
  await rm(publicLauncher);
  run("bun", [join(prefix, "lib/hot-cross-buns-terminal/ui/scripts/install.mjs"), "--recover", prefix]);
  assert.ok(await lstat(publicLauncher));
  assert.match(run("bun", [launcher, "note", "list"]).stdout, /Preserved install fixture/);
  const binary = join(prefix, "lib/hot-cross-buns-terminal/runtime", process.platform === "win32" ? "hot-cross-buns-runtime.exe" : "hot-cross-buns-runtime");
  const guard = await acquireUpdateGuard(binary, workspace, env);
  const uninstall = join(prefix, "lib/hot-cross-buns-terminal/ui/scripts/uninstall.mjs");
  try { assert.match(run("bun", [uninstall, prefix], false).stderr, /other work is using this profile/); }
  finally { await guard.release(); }
  assert.ok(await lstat(launcher));
  const nestedDrafts = join(prefix, "lib/hot-cross-buns-terminal/private-drafts"), marker = join(nestedDrafts, "retained-marker");
  await mkdir(nestedDrafts); await writeFile(marker, "Synthetic drafts survive a refused uninstall.");
  assert.match(run("bun", [uninstall, prefix], false, { ...env, HOT_CROSS_BUNS_TERMINAL_USER_DATA: nestedDrafts }).stderr, /profile or draft storage location is inside/);
  assert.equal(await readFile(marker, "utf8"), "Synthetic drafts survive a refused uninstall.");
  assert.ok(await lstat(publicLauncher));
  await rm(nestedDrafts, { recursive: true });
  run("bun", [uninstall, prefix]);
  await assert.rejects(lstat(launcher), { code: "ENOENT" });
  assert.match(run("bun", [join(artifact, "bin/hot-cross-buns"), "note", "list"]).stdout, /Preserved install fixture/);
  console.log("PASS: independent install/help/version, launcher recovery, scripted commands, active-profile and nested-draft uninstall refusal, packaged owned uninstall and retained user data.");
} finally { await rm(directory, { recursive: true, force: true }); }
