import { _electron as electron, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const profileDirectory = mkdtempSync(join(tmpdir(), "hcb-task-create-profile-"));
const taskCount = Number(process.env.HCB_TASK_CREATE_PROFILE_COUNT ?? "500");

async function finishOnboarding(page: Page): Promise<void> {
  const onboarding = page.getByRole("dialog", { name: "First-run setup" });
  await onboarding.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Finish setup" }).click();
  await onboarding.waitFor({ state: "hidden" });
}

async function main(): Promise<void> {
  const app = await electron.launch({
    args: [resolve(process.cwd()), `--user-data-dir=${profileDirectory}`],
    env: { ...process.env, HCB_TEST_DATABASE_ROOT: profileDirectory, NODE_ENV: "test" }
  });

  try {
    const page = await app.firstWindow();
    await page.getByTestId("app-shell").waitFor({ state: "visible" });
    await finishOnboarding(page);

    for (let index = 0; index < taskCount; index += 1) {
      const result = await page.evaluate(async (title) => window.hcb?.tasks.create({
        listId: "inbox",
        title,
        notes: "Synthetic task-create latency fixture."
      }), `Task create profile ${index}`);
      if (!result?.ok) throw new Error(`Fixture create ${index} failed.`);
    }

    await page.evaluate(() => window.dispatchEvent(new Event("hcb:core-data-invalidated")));
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const newTask = page.getByRole("button", { name: "New task", exact: true });
    await newTask.waitFor({ state: "visible" });
    await newTask.click();
    const title = page.getByRole("textbox", { name: "Task title" });
    await title.waitFor({ state: "visible" });
    await title.fill("Profiled quick create");

    const startedAt = await page.evaluate(() => performance.now());
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await page.getByTestId("inspector-shell").waitFor({ state: "hidden" });
    const closedAt = await page.evaluate(() => performance.now());
    await page.getByRole("button", { name: "Profiled quick create", exact: true }).waitFor({ state: "visible" });
    const visibleAt = await page.evaluate(() => performance.now());

    console.log(JSON.stringify({
      taskCount,
      closeMs: Number((closedAt - startedAt).toFixed(2)),
      visibleMs: Number((visibleAt - startedAt).toFixed(2))
    }));
  } finally {
    await app.close();
    rmSync(profileDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
