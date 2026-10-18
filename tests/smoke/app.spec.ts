import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.setTimeout(60_000);

test("launches and renders the planner shell", async () => {
  let electronApp: ElectronApplication | undefined;
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-smoke-"));

  try {
    electronApp = await electron.launch({
      args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`],
      env: {
        ...process.env,
        HCB_TEST_DATABASE_ROOT: profileDir,
        NODE_ENV: "test"
      }
    });

    const page = await electronApp.firstWindow();
    page.on("pageerror", (error) => {
      console.error(`Renderer error: ${error.stack ?? error.message}`);
    });

    await expect(page.getByTestId("app-shell")).toBeVisible();
    const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
    await expect(primaryNavigation.getByRole("button", { name: "Calendar Cmd 1" })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: "Tasks Cmd 2" })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: "Notes Cmd 3" })).toBeVisible();
    await expect(page.locator("#app-sidebar")).toHaveCount(0);

    const onboarding = page.getByRole("dialog", { name: "Hot Cross Buns" });
    await expect(onboarding).toBeVisible();
    await expect(onboarding.getByRole("heading", { name: "Welcome to Hot Cross Buns" })).toBeVisible();
    await expect(onboarding).toContainText("preview free time with Smart Schedule");
    await expect(onboarding.getByRole("button", { name: "Get started" })).toBeVisible();
  } finally {
    await electronApp?.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});

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
  } finally {
    await electronApp.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("virtualizes task trees while retaining keyboard navigation", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-task-tree-smoke-"));
  const electronApp = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`], env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" } });
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.evaluate(async () => {
      const setup = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual" });
      if (!setup.ok) throw new Error(setup.error.message);
      let parentId = "";
      for (let index = 0; index < 200; index += 1) {
        const result = await window.hcb!.tasks.create({ listId: "inbox", title: `Planner task ${String(index).padStart(3, "0")}`, notes: index === 0 ? "A long description that wraps across multiple lines. ".repeat(8) : "" });
        if (!result.ok) throw new Error(result.error.message);
        if (index === 0) parentId = result.data.id;
      }
      for (let index = 0; index < 10; index += 1) {
        const result = await window.hcb!.tasks.create({ listId: "inbox", parentId, title: `Child ${index}` });
        if (!result.ok) throw new Error(result.error.message);
      }
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Tasks/ }).click();
    await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-task-count", "210");
    const viewport = page.getByRole("list", { name: "Inbox tasks", exact: true });
    await expect(viewport.getByRole("button", { name: "Child 0", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Collapse subtasks for Planner task 000", exact: true }).click();
    await expect(viewport.getByRole("button", { name: "Child 0", exact: true })).toHaveCount(0);
    expect(await viewport.getByRole("listitem").count()).toBeLessThan(50);
    await viewport.focus();
    await viewport.press("End");
    await expect(viewport.getByRole("button", { name: "Planner task 199", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(viewport.getByRole("button", { name: "Planner task 000", exact: true })).toBeFocused();
    const overlap = await viewport.locator("[data-virtual-index]").evaluateAll((rows) => rows.some((row, index) => index > 0 && row.getBoundingClientRect().top < rows[index - 1].getBoundingClientRect().bottom - 1));
    expect(overlap).toBe(false);
    await page.screenshot({ path: join(tmpdir(), "hcb-task-board-after.png") });
  } finally {
    await electronApp.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
