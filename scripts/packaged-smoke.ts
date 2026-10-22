import { _electron as electron, expect, type ElectronApplication } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Test only a disposable installation and profile. Never replace an installed app.
async function main() {
  if (process.platform !== "darwin") throw new Error("This packaged smoke test requires macOS.");
  const root = mkdtempSync(join(tmpdir(), "hcb packaged smoke "));
  const bundle = join(root, "Test Installation", "Hot Cross Buns.app");
  const profile = join(root, "Disposable Profile");
  let application: ElectronApplication | undefined;
  try {
    cpSync(resolve("dist/preview/mac/Hot Cross Buns.app"), bundle, { recursive: true, verbatimSymlinks: true });
    const launch = async () => {
      application = await electron.launch({ executablePath: join(bundle, "Contents/MacOS/Hot Cross Buns"), args: [`--user-data-dir=${profile}`],
        env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile } });
      const page = await application.firstWindow();
      await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 60_000 });
      expect(await application.evaluate(({ app }) => app.isPackaged && app.getAppPath().endsWith("app.asar"))).toBe(true);
      return page;
    };
    let page = await launch();
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeVisible();
    const fixture = await page.evaluate(async () => {
      const settings = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual", notificationsEnabled: false });
      const note = await window.hcb!.notes.create({ title: "Packaged persistence", body: "# Preserved\n\nLocal **Markdown**." });
      const task = await window.hcb!.tasks.create({ listId: "inbox", title: "Queued packaged task", notes: "Keep pending" });
      const event = await window.hcb!.calendar.create({ calendarId: "primary", title: "Queued packaged event", startsAt: "2030-01-01T09:00:00Z", endsAt: "2030-01-01T10:00:00Z", allDay: false });
      const backup = await window.hcb!.settings.recoveryAction({ action: "backupNow" });
      for (const result of [settings, note, task, event, backup]) if (!result.ok) throw new Error(result.error.message);
      if (!note.ok || !task.ok || !event.ok || !backup.ok) throw new Error("Fixture creation failed.");
      return { noteId: note.data.id, taskId: task.data.id, eventId: event.data.id, backupPath: backup.data.path };
    });
    expect(existsSync(fixture.backupPath)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("hcb:core-data-invalidated")));
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Notes/ }).click();
    await page.getByRole("button", { name: "Open note Packaged persistence", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note body" }).getByRole("heading", { name: "Preserved" })).toBeVisible();
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Note body" })).toHaveValue("# Preserved\n\nLocal **Markdown**.");
    await page.getByRole("button", { name: "Visual", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Calendar/ }).click();
    await expect(page.getByRole("button", { name: "New event", exact: true })).toBeVisible();
    await page.waitForFunction(async () => {
      const result = await window.hcb!.native.capabilities({});
      return result.ok && result.data.deferredStartup.state === "complete";
    });
    // Observe the actual tray image, then recreate it through the public settings API.
    await application!.evaluate(({ Tray }) => {
      const original = Tray.prototype.setImage;
      (globalThis as any).__hcbTray = null;
      Tray.prototype.setImage = function(image) {
        (globalThis as any).__hcbTray = { tray: this, empty: typeof image === "string" || image.isEmpty() };
        return original.call(this, image);
      };
    });
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ showTrayIcon: false });
      const result = await window.hcb!.settings.update({ showTrayIcon: true, menuBarPanelStyle: "calendar", keybindings: { "quickAdd.open": "CommandOrControl+Alt+Shift+F9" } });
      if (!result.ok) throw new Error(result.error.message);
    });
    expect(await application!.evaluate(({ globalShortcut }) => ({ empty: (globalThis as any).__hcbTray?.empty,
      shortcut: globalShortcut.isRegistered("CommandOrControl+Alt+Shift+F9") }))).toEqual({ empty: false, shortcut: true });
    const native = await application!.evaluate(({ Menu, BrowserWindow, app }) => {
      const menu = Menu.getApplicationMenu();
      const hasEdit = menu?.items.some((item) => item.label === "Edit" && item.submenu?.items.some((child) => child.role === "paste"));
      const window = BrowserWindow.getAllWindows()[0];
      window.hide();
      app.emit("open-url", { preventDefault() {} } as Electron.Event, "hotcrossbuns://notes");
      return { hasEdit, visible: window.isVisible() };
    });
    expect(native).toEqual({ hasEdit: true, visible: true });
    await expect(page.getByRole("region", { name: "Notes pane", exact: true })).toBeVisible();
    await application!.close(); application = undefined;

    // Recreate the previous release's migration checkpoint inside our own fixture.
    const probe = join(root, "inspect-upgrade.cjs");
    writeFileSync(probe, `const Database = require(process.argv[2]);
const db = new Database(process.argv[3]);
const mode = process.argv[4];
if (mode === "downgrade") {
 db.exec("DROP TABLE google_event_cancellations; DROP INDEX events_google_recurring_calendar_idx; DELETE FROM schema_migrations; INSERT INTO schema_migrations VALUES(8)");
 db.prepare("INSERT OR REPLACE INTO sync_meta VALUES(?,?)").run("google-sync-token:fixture:events:calendar", "old-calendar-token");
 db.prepare("INSERT OR REPLACE INTO sync_meta VALUES(?,?)").run("google-sync-token:fixture:tasks:list", "keep-tasks-token");
} else if (mode === "checkpoint") {
 db.prepare("INSERT OR REPLACE INTO sync_meta VALUES(?,?)").run("google-sync-token:fixture:events:calendar", "new-calendar-token");
} else {
 const integrity = db.pragma("integrity_check", { simple: true });
 const version = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version;
 const tokens = db.prepare("SELECT key,value FROM sync_meta WHERE key LIKE 'google-sync-token:fixture:%'").all();
 const queued = db.prepare("SELECT entity_id FROM outbox WHERE state='pending'").all();
 console.log(JSON.stringify({integrity, version, tokens, queued}));
}
db.close();`);
    const inspect = (mode: string, path = join(profile, "hcb.sqlite")) => execFileSync(resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
      [probe, resolve("node_modules/better-sqlite3"), path, mode], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8" });
    expect(JSON.parse(inspect("inspect", fixture.backupPath)).integrity).toBe("ok");
    inspect("downgrade");
    page = await launch();
    const note = await page.evaluate((id) => window.hcb!.notes.get({ id }), fixture.noteId);
    expect(note.ok && note.data.body).toBe("# Preserved\n\nLocal **Markdown**.");
    await application!.close(); application = undefined;
    const upgraded = JSON.parse(inspect("inspect"));
    expect(upgraded.integrity).toBe("ok");
    expect(upgraded.version).toBe(9);
    expect(upgraded.tokens).toEqual([{ key: "google-sync-token:fixture:tasks:list", value: "keep-tasks-token" }]);
    expect(upgraded.queued.map((row: { entity_id: string }) => row.entity_id)).toEqual(expect.arrayContaining([fixture.taskId, fixture.eventId]));
    inspect("checkpoint");
    await launch();
    await application!.close(); application = undefined;
    expect(JSON.parse(inspect("inspect")).tokens).toEqual(expect.arrayContaining([
      { key: "google-sync-token:fixture:events:calendar", value: "new-calendar-token" }
    ]));
    console.log("Packaged ASAR launch, deferred rich editor, native SQLite worker, backup integrity, native menu/deep link, restart persistence, and v8→v9 upgrade passed.");
  } finally {
    await application?.close();
    rmSync(root, { recursive: true, force: true });
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
