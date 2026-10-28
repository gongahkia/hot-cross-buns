import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("persists a backup and recovers local notes through the worker", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-recovery-smoke-"));
  const electronApp = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`], env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" } });
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const created = await page.evaluate(async () => window.hcb!.notes.create({ title: "Recover this note", body: "Original text" }));
    if (!created.ok) throw new Error(created.error.message);
    const backup = await page.evaluate(async () => window.hcb!.settings.recoveryAction({ action: "backupNow" }));
    if (!backup.ok) throw new Error(backup.error.message);
    expect(backup.data.path).toContain(profileDir);
    const changed = await page.evaluate(async (id) => window.hcb!.notes.update({ id, body: "Changed text" }), created.data.id);
    if (!changed.ok) throw new Error(changed.error.message);
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
    }, backup.data.path);
    const rejected = await page.evaluate(async () => window.hcb!.settings.recoveryAction({ action: "restoreLocalNotes" }));
    expect(rejected.ok).toBe(false);
    const restored = await page.evaluate(async () => window.hcb!.settings.recoveryAction({ action: "restoreLocalNotes", confirmation: { accepted: true, phrase: "RESTORE NOTES" } }));
    if (!restored.ok) throw new Error(restored.error.message);
    const note = await page.evaluate(async (id) => window.hcb!.notes.get({ id }), created.data.id);
    if (!note.ok) throw new Error(note.error.message);
    expect(note.data.body).toBe("Original text");
    const unsupported = await page.evaluate(async () => window.hcb!.search.installModel({ modelId: "unused" }));
    expect(unsupported.ok).toBe(false);
    const timing = await page.evaluate(async () => window.hcb!.diagnostics.recordTiming({ name: "smoke.timing", kind: "ipc", durationMs: 7.25 }));
    if (!timing.ok) throw new Error(timing.error.message);
    expect(timing.data.recorded).toBe(true);
    const reportPath = join(profileDir, "diagnostics.json");
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
    }, reportPath);
    const exported = await page.evaluate(async () => window.hcb!.diagnostics.exportBundle());
    if (!exported.ok) throw new Error(exported.error.message);
    expect(exported.data.exported).toBe(true);
    const reportText = readFileSync(reportPath, "utf8");
    const report = JSON.parse(reportText);
    expect(report.summary.performance.timings).toContainEqual(expect.objectContaining({ name: "smoke.timing", durationMs: 7.25 }));
    expect(reportText).not.toContain("Original text");
  } finally {
    await electronApp.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
