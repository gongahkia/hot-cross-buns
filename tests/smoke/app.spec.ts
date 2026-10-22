import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { currentZonedDay, zonedDateTimeIso, zonedDayRange } from "../../src/shared/zonedTime";

test.setTimeout(60_000);

test("uses the displayed timezone at midnight and preserves the event timezone in its editor", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-calendar-zone-smoke-"));
  const electronApp = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`], env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" } });
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const day = currentZonedDay("Asia/Singapore");
    const range = zonedDayRange(day, "Asia/Singapore");
    const early = zonedDateTimeIso(day, 0, 30, "Asia/Singapore");
    const late = zonedDateTimeIso(day, 23, 30, "Asia/Singapore");
    const next = zonedDateTimeIso(day, 24, 30, "Asia/Singapore");
    const earlyId = await page.evaluate(async ({ day, early, late, next }) => {
      const setup = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual", defaultTimeZone: "Asia/Singapore" });
      if (!setup.ok) throw new Error(setup.error.message);
      let earlyId = "";
      for (const [title, startsAt, timeZone] of [["Near local midnight", early, "America/New_York"], ["Late local night", late, "Europe/London"], ["Tomorrow only", next, "UTC"]]) {
        const result = await window.hcb!.calendar.create({ calendarId: "primary", title, startsAt, endsAt: new Date(Date.parse(startsAt) + 15 * 60000).toISOString(), timeZone, allDay: false });
        if (!result.ok) throw new Error(result.error.message);
        if (title === "Near local midnight") earlyId = result.data.id;
      }
      const result = await window.hcb!.calendar.create({ calendarId: "primary", title: "Floating all-day date", startsAt: `${day}T00:00:00.000Z`, endsAt: new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString(), allDay: true });
      if (!result.ok) throw new Error(result.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return earlyId;
    }, { day, early, late, next });
    const calendar = page.getByTestId("calendar-view");
    await expect(calendar).toHaveAttribute("data-range-start", range.start);
    await expect(calendar).toHaveAttribute("data-range-end", range.end);
    await expect(calendar).toHaveAttribute("data-visible-event-count", "3");
    await expect(calendar.getByText("Near local midnight", { exact: true }).first()).toBeVisible();
    await expect(calendar.getByText("Late local night", { exact: true }).first()).toBeVisible();
    await expect(calendar.getByText("Floating all-day date", { exact: true }).first()).toBeVisible();
    await expect(calendar.getByText("Tomorrow only", { exact: true })).toHaveCount(0);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("hcb:open-entity", { detail: { kind: "event", id } })), earlyId);
    await expect(page.getByTestId("inspector-shell").getByText("Times in America/New_York", { exact: true })).toBeVisible();
    const originalDay = currentZonedDay("America/New_York", new Date(early));
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(early)).map((part) => [part.type, part.value]));
    // datetime-local has no implicit ARIA textbox role in Chromium.
    const startInput = page.getByLabel("Event starts", { exact: true });
    await expect(startInput).toHaveValue(`${originalDay}T${parts.hour}:${parts.minute}`);
    await page.getByRole("checkbox", { name: "All day", exact: true }).check();
    await expect(startInput).toHaveValue(originalDay);
    await page.getByRole("checkbox", { name: "All day", exact: true }).uncheck();
    await expect(startInput).toHaveValue(`${originalDay}T09:00`);
  } finally {
    await electronApp.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});

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
    await expect(primaryNavigation.getByRole("button", { name: "Calendar" })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: "Tasks" })).toBeVisible();
    await expect(primaryNavigation.getByRole("button", { name: "Notes" })).toBeVisible();
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

test("virtualizes task trees while retaining keyboard navigation", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-task-tree-smoke-"));
  const electronApp = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`], env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" } });
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const fixture = await page.evaluate(async () => {
      // Creation timestamps can tie, so use title order for the Home/End assertions.
      const setup = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual", taskListSorts: { inbox: "title" } });
      if (!setup.ok) throw new Error(setup.error.message);
      let parentId = "";
      for (let index = 0; index < 200; index += 1) {
        const result = await window.hcb!.tasks.create({ listId: "inbox", title: `Planner task ${String(index).padStart(3, "0")}`, notes: index === 0 ? "A long description that wraps across multiple lines. ".repeat(8) : "" });
        if (!result.ok) throw new Error(result.error.message);
        if (index === 0) parentId = result.data.id;
      }
      let childId = "";
      for (let index = 0; index < 10; index += 1) {
        const result = await window.hcb!.tasks.create({ listId: "inbox", parentId, title: `Child ${index}` });
        if (!result.ok) throw new Error(result.error.message);
        if (index === 0) childId = result.data.id;
      }
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return { parentId, childId };
    });
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Tasks/ }).click();
    await page.getByRole("button", { name: "Board", exact: true }).click();
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
    await expect(viewport.getByRole("button", { name: /^Planner task 000/ })).toBeFocused();
    const overlap = await viewport.locator("[data-virtual-index]").evaluateAll((rows) => rows.some((row, index) => index > 0 && row.getBoundingClientRect().top < rows[index - 1].getBoundingClientRect().bottom - 1));
    expect(overlap).toBe(false);
    await page.screenshot({ path: join(tmpdir(), "hcb-task-board-after.png") });
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("hcb:task-command", { detail: { action: "open-task", taskId: id } })), fixture.childId);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(viewport.getByRole("button", { name: "Child 0", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await viewport.focus(); await viewport.press("End");
    const last = viewport.getByRole("button", { name: "Planner task 199", exact: true });
    await expect(last).toBeFocused();
    await last.click({ button: "right" });
    await expect(page.getByRole("button", { name: "Move up", exact: true })).toBeEnabled();
    await page.getByRole("textbox", { name: "Find a parent task", exact: true }).fill("Planner task 000");
    await page.getByRole("button", { name: "Make subtask of Planner task 000", exact: true }).click();
    await expect.poll(async () => { const result = await page.evaluate(async () => window.hcb!.tasks.list({ query: "Planner task 199", summary: true, limit: 1 })); return result.ok && result.data.items[0]?.parentId; }).toBe(fixture.parentId);
    const destination = await page.evaluate(async () => {
      const result = await window.hcb!.tasks.createTaskList({ title: "Destination" });
      if (!result.ok) throw new Error(result.error.message);
      window.dispatchEvent(new Event("hcb:core-data-invalidated")); return result.data.id as string;
    });
    await expect(page.locator(`[data-task-list-id="${destination}"]`)).toBeVisible();
    await viewport.focus(); await viewport.press("End");
    const moving = viewport.getByRole("listitem").filter({ hasText: "Planner task 198" });
    await moving.dragTo(page.locator(`[data-task-list-id="${destination}"]`));
    await expect(page.getByRole("list", { name: "Destination tasks", exact: true }).getByRole("button", { name: "Planner task 198", exact: true })).toBeVisible();

  } finally {
    await electronApp.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("bounds offscreen columns and reads full notes beyond the initial cache", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-paging-smoke-"));
  let electronApp = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`], env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" } });
  try {
    let page = await electronApp.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const fixture = await page.evaluate(async () => {
      await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual" });
      let lastTaskId = "", lastListId = "", firstNoteId = "";
      for (let index = 0; index < 20; index += 1) {
        const list = await window.hcb!.tasks.createTaskList({ title: `List ${String(index).padStart(2, "0")}` });
        if (!list.ok) throw new Error(list.error.message);
        const task = await window.hcb!.tasks.create({ listId: list.data.id, title: `Task in list ${index}` });
        if (!task.ok) throw new Error(task.error.message);
        lastTaskId = task.data.id; lastListId = list.data.id;
      }
      for (let index = 0; index < 230; index += 1) {
        const note = await window.hcb!.notes.create({ title: `Paged note ${String(index).padStart(3, "0")}`, body: `Full body for note ${index}. ` + "This content stays out of the list cache. ".repeat(100) });
        if (!note.ok) throw new Error(note.error.message);
        if (index === 0) firstNoteId = note.data.id;
      }
      await window.hcb!.settings.update({ starredNoteIds: [firstNoteId], starredNoteAt: { [firstNoteId]: 1 }, starredTaskIds: [lastTaskId], taskListSorts: { [lastListId]: "title" } });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return { lastTaskId, lastListId, firstNoteId };
    });
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Tasks/ }).click();
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByTestId("tasks-board")).toHaveAttribute("data-task-count", "20");
    await expect.poll(() => page.locator('[data-column-loaded="true"]').count()).toBeLessThanOrEqual(6);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("hcb:task-command", { detail: { action: "open-task", taskId: id } })), fixture.lastTaskId);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("hcb:task-command", { detail: { action: "open-task", taskId: id } })), fixture.lastTaskId);
    await expect(page.getByRole("dialog")).toBeVisible();
    const closeInspector = page.getByRole("button", { name: "Close inspector", exact: true });
    await closeInspector.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("separator", { name: "Resize details panel", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeInspector).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Task in list 19", exact: true })).toBeVisible();
    await expect.poll(() => page.locator('[data-column-loaded="true"]').count()).toBeLessThanOrEqual(6);
    const starredNavigation = page.getByRole("button", { name: /^Starred on this device/ });
    await expect(starredNavigation).toContainText("1");
    await page.getByRole("button", { name: "Unstar Task in list 19", exact: true }).click();
    await expect(starredNavigation).toContainText("0");
    await page.getByRole("button", { name: "Star Task in list 19", exact: true }).click();
    await expect(starredNavigation).toContainText("1");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Notes/ }).click();
    await expect(page.getByRole("button", { name: "Open note Paged note 000", exact: true })).toBeVisible();
    const viewport = page.getByRole("list", { name: "Notes", exact: true });
    await expect(viewport).toHaveAttribute("data-total-count", "230");
    expect(Number(await viewport.getAttribute("data-loaded-count"))).toBeLessThanOrEqual(600);
    await viewport.focus();
    await viewport.press("End");
    await expect(viewport.locator('[data-virtual-index="229"]')).toBeVisible();
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("hcb:note-command", { detail: { action: "open-note", noteId: id } })), fixture.firstNoteId);
    const body = page.getByRole("textbox", { name: "Note body" });
    expect((await body.innerText()).length).toBeGreaterThan(4000);
    await page.screenshot({ path: join(tmpdir(), "hcb-note-inspector-flat.png") });
    await page.keyboard.press("Escape");
    await page.screenshot({ path: join(tmpdir(), "hcb-notes-paged-after.png") });
    await expect.poll(async () => { const result = await page.evaluate(async () => window.hcb!.settings.get()); return result.ok && result.data.paneWorkspace?.root; }).toBeTruthy();
    const event = await page.evaluate(async () => window.hcb!.calendar.create({ calendarId: "primary", title: "Full event details", description: "Complete event content. ".repeat(200), startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() }));
    if (!event.ok) throw new Error(event.error.message);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Calendar/ }).click();
    await page.evaluate((id) => {
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      window.dispatchEvent(new CustomEvent("hcb:open-entity", { detail: { kind: "event", id } }));
    }, event.data.id);
    expect((await page.getByRole("textbox", { name: "Event notes", exact: true }).innerText()).length).toBeGreaterThan(4000);
    await page.keyboard.press("Escape");
    await electronApp.close();
    electronApp = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`], env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" } });
    page = await electronApp.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await expect(page.getByTestId("app-shell")).toBeVisible();
    const settings = await page.evaluate(async () => window.hcb!.settings.get());
    if (!settings.ok) throw new Error(settings.error.message);
    expect(settings.data.starredNoteIds).toContain(fixture.firstNoteId);
    expect(settings.data.starredTaskIds).toContain(fixture.lastTaskId);
    expect(settings.data.taskListSorts[fixture.lastListId]).toBe("title");
    expect(settings.data.paneWorkspace.root).toBeTruthy();
    expect(settings.data.paneWorkspace.updatedAt).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});


test("restores web-only workspaces to Calendar with embedded browsing disabled", async () => {
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-retired-web-smoke-"));
  const electronApp = await electron.launch({ args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`], env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDir, NODE_ENV: "test" } });
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.evaluate(async () => {
      const paneWorkspace = { focusedPaneId: "web-fixture", updatedAt: Date.now(), root: { id: "web-fixture", kind: "leaf", content: { kind: "web", activeTabId: "tab-fixture", tabs: [{ id: "tab-fixture", title: "Old reference page", url: "https://example.com/" }] } } };
      await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual", paneWorkspace });
      localStorage.setItem("hcb.paneWorkspace.v1", JSON.stringify(paneWorkspace));
    });
    await page.reload();
    await expect(page.getByTestId("calendar-view")).toBeVisible();
    await expect(page.getByTestId("pane-leaf")).toHaveCount(1);
    await expect(page.locator("webview")).toHaveCount(0);
    expect(await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().filter((contents) => contents.getType() === "webview").length)).toBe(0);
    expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().webviewTag)).toBe(false);
  } finally {
    await electronApp.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
