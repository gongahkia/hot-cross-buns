import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { resolve } from "node:path";

test("launches and renders the planner shell", async () => {
  let electronApp: ElectronApplication | undefined;

  try {
    electronApp = await electron.launch({
      args: [resolve(__dirname, "../..")],
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
    const finishSetup = page.getByRole("button", { name: "Finish setup" });
    if (await finishSetup.isVisible()) {
      await finishSetup.click();
      await expect(finishSetup).toBeHidden();
    }

    for (const label of ["Tasks", "Calendar", "Notes"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

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

    const health = await page.evaluate(async () => globalThis.window.hcb?.diagnostics.health());
    expect(health?.ok).toBe(true);
  } finally {
    await electronApp?.close();
  }
});
