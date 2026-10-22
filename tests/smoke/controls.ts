import { expect, type Locator, type Page } from "@playwright/test";

/** Interact with the rendered popup. selectOption() bypasses popup painting and
 * would miss the blank menus that prompted this regression suite. */
export async function chooseOption(page: Page, control: Locator, label: string) {
  await control.click();
  const option = page.getByRole("listbox").getByRole("option", { name: label, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

export async function chooseOptionValue(page: Page, control: Locator, value: string) {
  await control.click();
  const options = page.getByRole("listbox").getByRole("option");
  const index = await options.evaluateAll((items, wanted) => items.findIndex(item => item.getAttribute("data-value") === wanted), value);
  expect(index).toBeGreaterThanOrEqual(0);
  await options.nth(index).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}
