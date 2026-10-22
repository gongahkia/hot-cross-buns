import { expect, test } from "@playwright/test";
import { planner, capture } from "./planner";
import { chooseCalendarView } from "./calendarActions";
import { seedDatabase } from "./database";

test("read-only calendar events stay readable and copyable while edits and gestures are unavailable", async () => {
  await planner(async (page, app) => {
    const id = await page.evaluate(async () => {
      const event = await window.hcb!.calendar.create({ calendarId: "primary", title: "Shared appointment", description: "Shared details remain readable", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z" });
      if (!event.ok) throw new Error(event.error.message);
      return event.data.id;
    });
    // Seed provider permissions only in the disposable fixture's database.
    // Behavior and persistence assertions below use the real renderer and IPC.
    await seedDatabase(app, [
      { sql: "UPDATE calendars SET account_id='read-only-fixture',access_role='reader',title='Shared read-only' WHERE id='primary'" },
      { sql: "INSERT INTO calendars(id,account_id,title,created_at,updated_at) VALUES('writable-fixture','local','Personal writable',?,?)", values: [new Date().toISOString(), new Date().toISOString()] }
    ]);
    await page.reload();
    await chooseCalendarView(page, "week");
    await page.getByRole("button", { name: "Choose calendar date" }).click();
    await page.getByLabel("Go to date", { exact: true }).fill("2027-01-12");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const chip = page.locator('.calendar-event-chip[data-read-only="true"]').filter({ hasText: "Shared appointment" });
    await expect(chip).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Resize Shared appointment/ })).toHaveCount(0);
    await chip.click();
    await expect(page.getByTestId("inspector-shell")).toContainText("This calendar is read-only");
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("inspector-shell")).toContainText("Shared details remain readable");
    await page.getByRole("button", { name: "Item actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Cut", exact: true })).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    const refused = await page.evaluate(async id => window.hcb!.calendar.update({ id, title: "Stale edit" }), id);
    expect(refused.ok).toBe(false);
    await chip.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Delete event", exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("menuitem", { name: "Duplicate event", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Event title", exact: true })).toHaveValue("Shared appointment (copy)");
    await expect.poll(() => page.evaluate(async () => {
      const saved = await window.hcb!.calendar.listEvents({ start: "2027-01-12T00:00:00Z", end: "2027-01-13T00:00:00Z" });
      return saved.ok && saved.data.items.some((event: any) => event.title === "Shared appointment (copy)" && event.calendarId === "writable-fixture");
    })).toBe(true);
    await capture(page, "read-only-calendar-copy");
  });
});
