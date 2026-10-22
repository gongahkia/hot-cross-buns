import { expect } from "@playwright/test";
import { test, planner } from "./planner";

test("native item links reveal their exact targets across lazy sections and Today resets the date", async () => {
  await planner(async (page, app) => {
    const ids = await page.evaluate(async () => {
      const api = window.hcb!;
      const event = await api.calendar.create({ calendarId: "primary", title: "Native March target", startsAt: "2027-03-03T09:00:00Z", endsAt: "2027-03-03T10:00:00Z" });
      const task = await api.tasks.create({ listId: "inbox", title: "Native task target" });
      const note = await api.notes.create({ title: "Native note target", body: "Native route content" });
      if (!event.ok || !task.ok || !note.ok) throw new Error("Could not seed native route targets");
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
      return { event: event.data.id, task: task.data.id, note: note.data.id };
    });
    const open = (kind: string, id?: string) => app.evaluate(({ BrowserWindow }, route) => {
      BrowserWindow.getAllWindows()[0].webContents.send("hcb:native-action", { type: "openRoute", route });
    }, { kind, ...(id ? { id } : {}) });
    await open("event", ids.event);
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Native March target");
    await expect.poll(async () => {
      const range = page.getByTestId("calendar-view");
      return (await range.getAttribute("data-range-start"))! <= "2027-03-03T09:00:00Z" && (await range.getAttribute("data-range-end"))! > "2027-03-03T09:00:00Z";
    }).toBe(true);
    await open("task", ids.task);
    await expect(page.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue("Native task target");
    await open("note", ids.note);
    await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("Native note target");
    await open("event", ids.event);
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Native March target");
    await open("today");
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    const today = new Date().toISOString();
    await expect.poll(async () => {
      const range = page.getByTestId("calendar-view");
      return (await range.getAttribute("data-range-start"))! <= today && (await range.getAttribute("data-range-end"))! > today;
    }).toBe(true);
    await open("event", "missing-event");
    await expect(page.getByText("Calendar event could not be opened from search.", { exact: true })).toBeVisible();
  });
});
