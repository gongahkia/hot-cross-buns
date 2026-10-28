import { expect, test, type Page } from "@playwright/test";

async function call(page: Page, namespace: string, action: string, payload: Record<string, unknown> = {}) {
  return page.evaluate(async ({ namespace, action, payload }) => {
    const result = await window.hcb![namespace][action](payload);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }, { namespace, action, payload });
}

test("another tab refreshes the task board and preserves an open draft until it closes", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await call(page, "settings", "update", { onboardingStatus: "completed", syncMode: "manual" });
  const task = await call(page, "tasks", "create", { listId: "inbox", title: "Shared browser task" });

  const editing = await context.newPage();
  await editing.goto("/");
  await expect(editing.getByTestId("app-shell")).toBeVisible();
  await editing.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Tasks", exact: true }).click();
  await editing.bringToFront();
  await expect(editing.getByRole("button", { name: "Shared browser task", exact: true })).toBeVisible();

  // No reload or explicit renderer invalidation: only the durable commit's
  // BroadcastChannel message causes this existing board to refresh.
  await call(page, "tasks", "update", { id: task.id, title: "Changed in the other tab" });
  const row = editing.getByRole("button", { name: "Changed in the other tab", exact: true });
  await expect(row).toBeVisible();
  await row.click();
  const title = editing.getByRole("textbox", { name: "Task title", exact: true });
  await title.fill("My unsaved browser draft");
  await expect(title).toBeFocused();
  expect(await call(page, "tasks", "get", { id: task.id })).toMatchObject({ title: "Changed in the other tab" });

  await editing.evaluate(() => {
    (window as any).__receivedWorkspaceChange = false;
    window.hcb!.workspace.subscribeChanges(() => { (window as any).__receivedWorkspaceChange = true; });
  });
  await call(page, "tasks", "create", { listId: "inbox", title: "Arrived while editing" });
  await expect.poll(() => editing.evaluate(() => (window as any).__receivedWorkspaceChange)).toBe(true);
  // Let the debounced refresh attempt run while the unsaved editor is open.
  await editing.waitForTimeout(300);
  await expect(title).toHaveValue("My unsaved browser draft");
  await expect(title).toBeFocused();
  await expect(editing.getByRole("button", { name: "Arrived while editing", exact: true })).toHaveCount(0);
  expect(await call(page, "tasks", "get", { id: task.id })).toMatchObject({ title: "Changed in the other tab" });

  await editing.getByRole("button", { name: "Close inspector", exact: true }).click();
  await expect(editing.getByTestId("inspector-shell")).toHaveCount(0);
  await expect(editing.getByRole("button", { name: "My unsaved browser draft", exact: true })).toBeVisible();
  await expect(editing.getByRole("button", { name: "Arrived while editing", exact: true })).toBeVisible();
  expect(await call(page, "tasks", "get", { id: task.id })).toMatchObject({ title: "My unsaved browser draft" });
});
