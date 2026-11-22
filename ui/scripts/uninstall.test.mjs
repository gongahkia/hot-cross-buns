import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, lstat, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const runtimeName = process.platform === "win32" ? "hot-cross-buns-runtime.exe" : "hot-cross-buns-runtime";
const binary = resolve(process.env.HOT_CROSS_BUNS_TEST_BINARY || join("ui/runtime", runtimeName));
const uninstall = resolve("ui/scripts/uninstall.mjs");
async function installation() {
  const temporary = await mkdtemp(join(tmpdir(), "hot-cross-buns-uninstall-")), prefix = join(temporary, "prefix"), root = join(prefix, "lib/hot-cross-buns-terminal");
  const launcher = join(prefix, "bin", process.platform === "win32" ? "hot-cross-buns.cmd" : "hot-cross-buns");
  await mkdir(join(root, "runtime"), { recursive: true }); await mkdir(dirname(launcher), { recursive: true });
  await copyFile(binary, join(root, "runtime", runtimeName), constants.COPYFILE_FICLONE);
  await writeFile(join(root, "installation.json"), JSON.stringify({ product: "hot-cross-buns-terminal", version: 1, root, launcher, prefix }));
  if (process.platform === "win32") await writeFile(launcher, '@echo off\r\nbun "%~dp0..\\lib\\hot-cross-buns-terminal\\bin\\hot-cross-buns" %*\r\n');
  else await symlink(join("..", "lib/hot-cross-buns-terminal/bin/hot-cross-buns"), launcher);
  const env = { ...process.env, HOT_CROSS_BUNS_STATE_DIR: join(temporary, "state"), HOT_CROSS_BUNS_CONFIG_DIR: join(temporary, "configuration"), HOT_CROSS_BUNS_TERMINAL_USER_DATA: join(temporary, "app"), HOT_CROSS_BUNS_DESKTOP_USER_DATA: join(temporary, "desktop") };
  const run = () => spawnSync(process.execPath, [uninstall, prefix], { env, cwd: temporary, encoding: "utf8", timeout: 20000 });
  return { temporary, prefix, root, launcher, env, run, close: () => rm(temporary, { recursive: true, force: true }) };
}

test("uninstall refuses state, configuration and either draft store inside its owned tree", async t => {
  for (const variable of ["HOT_CROSS_BUNS_STATE_DIR", "HOT_CROSS_BUNS_CONFIG_DIR", "HOT_CROSS_BUNS_TERMINAL_USER_DATA", "HOT_CROSS_BUNS_DESKTOP_USER_DATA"]) {
    await t.test(variable, async () => {
      const fixture = await installation();
      try {
        const location = join(fixture.root, "private profile"); fixture.env[variable] = location;
        const directory = ["HOT_CROSS_BUNS_STATE_DIR", "HOT_CROSS_BUNS_CONFIG_DIR"].includes(variable) ? join(location, "hot-cross-buns") : location;
        await mkdir(directory, { recursive: true });
        const marker = join(directory, "retained-marker"); await writeFile(marker, "Synthetic private data.");
        const result = fixture.run();
        assert.notEqual(result.status, 0); assert.match(result.stderr, /profile or draft storage location is inside/);
        assert.equal(await readFile(marker, "utf8"), "Synthetic private data.");
        assert.ok(await lstat(fixture.launcher)); assert.ok(await lstat(fixture.root));
      } finally { await fixture.close(); }
    });
  }
});

test("uninstall resolves directory aliases and missing descendants before removal", async t => {
  for (const missing of [false, true]) await t.test(missing ? "missing target" : "existing target", async t => {
    const fixture = await installation();
    try {
      const target = join(fixture.root, "private drafts"), alias = join(fixture.temporary, "external-looking-link");
      if (!missing) await mkdir(target);
      try { await symlink(target, alias, process.platform === "win32" ? "junction" : "dir"); }
      catch (error) { if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) { t.skip("directory links unavailable"); return; } throw error; }
      fixture.env.HOT_CROSS_BUNS_TERMINAL_USER_DATA = join(alias, "not-created-yet");
      const result = fixture.run();
      assert.notEqual(result.status, 0); assert.match(result.stderr, /profile or draft storage location is inside/);
      assert.ok(await lstat(fixture.launcher)); assert.ok(await lstat(fixture.root));
    } finally { await fixture.close(); }
  });
});

test("uninstall protects the default draft location without explicit overrides", async () => {
  const fixture = await installation();
  try {
    delete fixture.env.HOT_CROSS_BUNS_TERMINAL_USER_DATA; delete fixture.env.HOT_CROSS_BUNS_DESKTOP_USER_DATA;
    let location;
    if (process.platform === "win32") { fixture.env.APPDATA = join(fixture.root, "application data"); location = join(fixture.env.APPDATA, "Hot Cross Buns"); }
    else if (process.platform === "darwin") { fixture.env.HOME = join(fixture.root, "home"); location = join(fixture.env.HOME, "Library/Application Support/Hot Cross Buns"); }
    else { fixture.env.XDG_CONFIG_HOME = join(fixture.root, "xdg"); location = join(fixture.env.XDG_CONFIG_HOME, "Hot Cross Buns"); }
    await mkdir(location, { recursive: true }); await writeFile(join(location, "retained-marker"), "Keep default drafts.");
    const result = fixture.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /profile or draft storage location is inside/);
    assert.equal(await readFile(join(location, "retained-marker"), "utf8"), "Keep default drafts.");
  } finally { await fixture.close(); }
});

test("uninstall retains external profile data and does not confuse sibling path prefixes", async () => {
  const fixture = await installation();
  try {
    fixture.env.HOT_CROSS_BUNS_TERMINAL_USER_DATA = fixture.root + "-private";
    for (const directory of [join(fixture.env.HOT_CROSS_BUNS_STATE_DIR, "hot-cross-buns"), join(fixture.env.HOT_CROSS_BUNS_CONFIG_DIR, "hot-cross-buns"), fixture.env.HOT_CROSS_BUNS_TERMINAL_USER_DATA]) {
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, "retained-marker"), "Keep.");
    }
    const result = fixture.run(); assert.equal(result.status, 0, result.stderr);
    await assert.rejects(lstat(fixture.root), { code: "ENOENT" }); await assert.rejects(lstat(fixture.launcher), { code: "ENOENT" });
    for (const directory of [join(fixture.env.HOT_CROSS_BUNS_STATE_DIR, "hot-cross-buns"), join(fixture.env.HOT_CROSS_BUNS_CONFIG_DIR, "hot-cross-buns"), fixture.env.HOT_CROSS_BUNS_TERMINAL_USER_DATA]) assert.equal(await readFile(join(directory, "retained-marker"), "utf8"), "Keep.");
  } finally { await fixture.close(); }
});
