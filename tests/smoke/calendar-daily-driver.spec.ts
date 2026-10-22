import { expect, test, type Page } from "@playwright/test";
import { planner } from "./planner";
import { chooseCalendarView } from "./calendarActions";

test.setTimeout(60_000);

async function goToDate(page: Page, day: string) {
  await page.getByRole("button", { name: "Choose calendar date" }).click();
  await page.getByLabel("Go to date", { exact: true }).fill(day);
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

test("scheduled-block completion and reopening update the task and all its blocks across reload", async () => {
  await planner(async page => {
    const ids = await page.evaluate(async () => {
      const api = window.hcb!;
      const task = await api.tasks.create({ listId: "inbox", title: "Scheduled daily work", dueDate: "2027-01-20" });
      if (!task.ok) throw new Error(task.error.message);
      const events: string[] = [];
      for (const startsAt of ["2027-01-12T09:00:00Z", "2027-01-13T09:00:00Z"]) {
        const block = await api.calendar.scheduleTaskBlock({ taskId: task.data.id, calendarId: "primary", startsAt, durationMinutes: 60 });
        if (!block.ok) throw new Error(block.error.message);
        events.push(block.data.calendarEventId);
      }
      await api.settings.update({ showCompletedInCalendarViews: true });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return { task: task.data.id, events };
    });
    await chooseCalendarView(page, "month"); await goToDate(page, "2027-01-12");
    const state = () => page.evaluate(async ({ task, events }) => {
      const taskResult = await window.hcb!.tasks.get({ id: task });
      const blocks = await Promise.all(events.map(id => window.hcb!.calendar.get({ id })));
      return { task: taskResult.ok ? taskResult.data.status : "error", completed: blocks.map(item => item.ok && Boolean(item.data.completedAt)) };
    }, ids);
    await page.locator('.calendar-month .calendar-event-chip[data-source="event"]').filter({ hasText: "Scheduled daily work" }).first().hover();
    await page.getByRole("button", { name: "Complete task Scheduled daily work", exact: true }).first().click();
    await expect.poll(state).toEqual({ task: "completed", completed: [true, true] });
    await expect(page.getByRole("button", { name: "Reopen task Scheduled daily work", exact: true })).toHaveCount(2);
    await page.reload();
    await page.locator('.calendar-month .calendar-event-chip[data-source="event"]').filter({ hasText: "Scheduled daily work" }).last().hover();
    await page.getByRole("button", { name: "Reopen task Scheduled daily work", exact: true }).last().click();
    await expect.poll(state).toEqual({ task: "active", completed: [false, false] });
    await expect(page.getByRole("button", { name: "Complete task Scheduled daily work", exact: true })).toHaveCount(2);
  });
});
