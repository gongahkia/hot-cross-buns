import { expect, test } from "@playwright/test";
import { planner, capture } from "./planner";
import { chooseCalendarView } from "./calendarActions";
import { seedDatabase } from "./database";

test("calendar shows queued and failed delivery on affected events and opens existing sync recovery", async () => {
  await planner(async (page, app) => {
    const id = await page.evaluate(async () => {
      const event = await window.hcb!.calendar.create({ calendarId: "primary", title: "Delivery feedback", startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z" });
      if (!event.ok) throw new Error(event.error.message);
      return event.data.id;
    });
    await seedDatabase(app, [
      { sql: "UPDATE calendars SET account_id='sync-fixture',access_role='writer' WHERE id='primary'" },
      { sql: "UPDATE outbox SET account_id='sync-fixture' WHERE entity_id=?", values: [id] }
    ]);
    const refresh = () => page.evaluate(async () => {
      await window.hcb!.settings.update({ syncMode: "manual" });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await refresh();
    await chooseCalendarView(page, "month");
    await page.getByRole("button", { name: "Choose calendar date" }).click();
    await page.getByLabel("Go to date", { exact: true }).fill("2027-01-12");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const chip = page.locator('.calendar-event-chip').filter({ hasText: "Delivery feedback" });
    await expect(chip).toHaveAttribute("data-sync-state", "queued");
    await expect(chip.getByRole("img", { name: "Saved locally — waiting for Google sync" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Calendar status" })).toContainText("waiting for Google sync");
    await seedDatabase(app, [{ sql: "UPDATE outbox SET state='conflict',last_error='Provider rejected this edit',attempts=1 WHERE entity_id=?", values: [id] }]);
    await refresh();
    await expect(chip).toHaveAttribute("data-sync-state", "failed");
    await expect(page.getByRole("status", { name: "Calendar status" })).toContainText("Some changes have not reached Google");
    await chip.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Review sync status", exact: true }).click();
    await expect(page.getByText("Provider rejected this edit", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare and resolve", exact: true })).toBeVisible();
    await capture(page, "calendar-delivery-recovery");
  });
});
