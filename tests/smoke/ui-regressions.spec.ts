import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.setTimeout(60_000);

async function withPlanner(run: (page: Page) => Promise<void>): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), "hcb-ui-regression-"));
  const app = await electron.launch({
    args: [resolve(__dirname, "../.."), `--user-data-dir=${profile}`],
    env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile }
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.evaluate(async () => {
      await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual" });
      window.dispatchEvent(new Event("hcb:core-data-invalidated"));
    });
    await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
    await run(page);
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

test("primary and selected controls retain their visual states", async () => {
  await withPlanner(async (page) => {
    const create = page.getByRole("button", { name: "New event", exact: true });
    await expect(create).toBeVisible();
    const style = await create.evaluate((element) => {
      const css = getComputedStyle(element);
      return { background: css.backgroundColor, border: css.borderTopWidth, foreground: css.color };
    });
    expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.border).not.toBe("0px");
    const expectedForeground = await create.evaluate(() => { const sample = document.createElement("span"); sample.style.color = "var(--color-accent-foreground)"; document.body.append(sample); const color = getComputedStyle(sample).color; sample.remove(); return color; });
    expect(style.foreground).toBe(expectedForeground);
  });
});

test("creates a named list through an accessible application dialog", async () => {
  await withPlanner(async (page) => {
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: /^Tasks/ }).click();
    await page.getByRole("button", { name: "New list", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create new list", exact: true });
    await expect(dialog.getByRole("button", { name: "Create list" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "List name" }).fill("Design follow-up");
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.hcb!.tasks.listTaskLists({});
      return result.ok && result.data.items.some((list) => list.title === "Design follow-up");
    })).toBe(true);
  });
});
