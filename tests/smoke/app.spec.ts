import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("launches and renders the planner shell", async () => {
  let electronApp: ElectronApplication | undefined;
  const profileDir = mkdtempSync(join(tmpdir(), "hcb-smoke-"));

  try {
    electronApp = await electron.launch({
      args: [resolve(__dirname, "../.."), `--user-data-dir=${profileDir}`],
      env: {
        ...process.env,
        NODE_ENV: "test"
      }
    });

    const page = await electronApp.firstWindow();
    page.on("pageerror", (error) => {
      console.error(`Renderer error: ${error.stack ?? error.message}`);
    });

    await expect(page.getByTestId("app-shell")).toBeVisible();
    const onboarding = page.getByRole("dialog", { name: "First-run setup" });
    await expect(onboarding).toBeVisible();
    const finishSetup = page.getByRole("button", { name: "Finish setup" });
    await finishSetup.click();
    await expect(onboarding).toBeHidden();

    for (const label of ["Tasks", "Calendar", "Notes"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    const themePicker = page.getByRole("list", { name: "Color themes" });
    await expect(themePicker.getByRole("listitem")).toHaveCount(34);
    await page.getByLabel("Search color themes").fill("Dracula");
    await expect(themePicker.getByRole("listitem")).toHaveCount(2);
    await themePicker.getByRole("button", { name: /^Dracula VS Code \+ Ghostty/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "dracula");
    await page.getByLabel("Search color themes").fill("Catppuccin");
    await themePicker.getByRole("button", { name: /^Catppuccin Mocha VS Code \+ Ghostty/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "catppuccin-mocha");
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "catppuccin-latte");
    await page.getByLabel("Search color themes").fill("");
    await expect(themePicker.getByRole("listitem")).toHaveCount(16);
    const searchLoader = page.getByLabel("Command palette search loading indicator");
    await expect(searchLoader).toHaveValue("blocks");
    await searchLoader.selectOption("wave");
    await expect(page.locator(".ld-wave").first()).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();

    const title = `smoke task ${Date.now()}`;
    const mutation = await page.evaluate(async ({ title, startsAt, endsAt }) => {
      const task = await window.hcb?.tasks.create({ listId: "inbox", title, notes: "Created through the restored bridge." });
      const event = await window.hcb?.calendar.create({
        calendarId: "primary",
        title,
        startsAt,
        endsAt,
        allDay: false
      });
      const note = await window.hcb?.notes.create({ title, body: "SQLite-backed smoke note." });
      const tasks = await window.hcb?.tasks.list({ status: "all", limit: 100 });
      return { task, event, note, tasks };
    }, {
      title,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:00:00.000Z"
    });

    expect(mutation.task?.ok).toBe(true);
    expect(mutation.event?.ok).toBe(true);
    expect(mutation.note?.ok).toBe(true);
    expect(mutation.tasks?.ok).toBe(true);
    if (!mutation.tasks?.ok) {
      throw new Error("Task list request failed after the SQLite mutation.");
    }
    expect(mutation.tasks?.data.items.some((task: { title: string }) => task.title === title)).toBe(true);

    const scheduledBlock = await page.evaluate(async ({ taskId, startsAt }) =>
      globalThis.window.hcb?.calendar.scheduleTaskBlock({
        taskId,
        calendarId: "primary",
        startsAt,
        durationMinutes: 30
      }), { taskId: mutation.task?.ok ? mutation.task.data.id : "", startsAt: "2026-10-02T09:00:00.000Z" });
    expect(scheduledBlock?.ok).toBe(true);
    if (!scheduledBlock?.ok) {
      throw new Error("Scheduled task-block request failed.");
    }
    expect(scheduledBlock.data.taskId).toBe(mutation.task?.ok ? mutation.task.data.id : "");
    expect(scheduledBlock.data.calendarEventId).toBeTruthy();

    const availability = await page.evaluate(async () => globalThis.window.hcb?.calendar.exportAvailability({
      calendarIds: ["primary"], start: "2026-10-02T08:00:00.000Z", end: "2026-10-02T11:00:00.000Z", format: "text"
    }));
    expect(availability?.ok).toBe(true);
    if (!availability?.ok) throw new Error("Availability export failed.");
    expect(availability.data.busyBlockCount).toBeGreaterThan(0);

    const undoneBlock = await page.evaluate(async () => globalThis.window.hcb?.undo.undo());
    expect(undoneBlock?.ok).toBe(true);
    expect(undoneBlock?.ok && undoneBlock.data.applied).toBe(true);
    const redoneBlock = await page.evaluate(async () => globalThis.window.hcb?.undo.redo());
    expect(redoneBlock?.ok).toBe(true);
    expect(redoneBlock?.ok && redoneBlock.data.applied).toBe(true);

    const search = await page.evaluate(async (query) => globalThis.window.hcb?.search.query({ query, limit: 10 }), title);
    expect(search?.ok).toBe(true);
    if (!search?.ok) {
      throw new Error("Search request failed.");
    }
    expect(search.data.items.some((item: { title: string }) => item.title === title)).toBe(true);

    const disconnectedSync = await page.evaluate(async () => globalThis.window.hcb?.sync.runNow({ reason: "smoke" }));
    expect(disconnectedSync?.ok).toBe(true);
    if (!disconnectedSync?.ok) {
      throw new Error("Disconnected sync request failed.");
    }
    expect(disconnectedSync.data.state).toBe("idle");

    const health = await page.evaluate(async () => globalThis.window.hcb?.diagnostics.health());
    expect(health?.ok).toBe(true);
  } finally {
    await electronApp?.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
});
