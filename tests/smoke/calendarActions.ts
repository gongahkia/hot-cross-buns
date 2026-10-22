import { type Page } from "@playwright/test";
export async function chooseCalendarView(page: Page, view: string, beforeSelect?: () => Promise<void>) {
  await page.getByRole("button", { name: "Calendar view", exact: true }).click();
  if (view === "multiDay") {
    await page.getByRole("menuitem", { name: "Number of days" }).hover();
    await beforeSelect?.();
    await page.getByRole("menuitem", { name: "3 days", exact: true }).click();
  } else {
    await beforeSelect?.();
    await page.getByRole("menuitemradio", { name: ({ day: "Day", week: "Week", month: "Month", agenda: "Agenda" } as Record<string, string>)[view], exact: true }).click();
  }
}
export async function newCalendarEvent(page: Page) {
  await page.getByRole("button", { name: "Calendar tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "New event", exact: true }).click();
}
