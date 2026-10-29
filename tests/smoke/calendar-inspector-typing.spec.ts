import { expect } from "@playwright/test";
import { planner, test } from "./planner";
import { replaceRichText } from "./richTextActions";

test("keeps every rapidly typed event-description character through save and reload", async () => {
  await planner(async page => {
    const id = await page.evaluate(async () => {
      const result = await window.hcb!.calendar.create({
        calendarId: "primary", title: "Rapid description fixture", notes: "Original description",
        startsAt: "2027-01-12T09:00:00Z", endsAt: "2027-01-12T10:00:00Z"
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data.id;
    });
    const open = () => page.evaluate(id => window.dispatchEvent(new CustomEvent("hcb:open-entity", { detail: { kind: "event", id } })), id);
    await open();
    const description = page.getByRole("textbox", { name: "Event notes", exact: true });
    await expect(description).toHaveText("Original description");
    const text = "Every character survives: ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789. Fast typing must keep the complete description.";
    await replaceRichText(description, text);
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect(page.getByTestId("inspector-shell")).toHaveCount(0);
    await expect.poll(() => page.evaluate(async id => {
      const result = await window.hcb!.calendar.get({ id });
      return result.ok ? result.data.notes : null;
    }, id)).toBe(text);
    await page.reload();
    await expect(page.getByRole("button", { name: "Calendar tools", exact: true })).toBeVisible();
    await open();
    await expect(description).toHaveText(text);
  });
});
