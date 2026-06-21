import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runLocalDataMigrations } from "../../src/main/data/migrations";
import { createAppSqliteConnection } from "../../src/main/data/sqliteConnection";
import { GoogleSyncRepository } from "../../src/main/sync/readSyncRepository";

const now = "2026-05-22T00:00:00.000Z";
const expectedAdapterIds: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "electron-mac",
  linux: "electron-linux-preview",
  win32: "electron-windows-preview"
};

test.setTimeout(90_000);

function seedSmokeDatabase(appSupportDirectory: string): void {
  const connection = createAppSqliteConnection({ appSupportDirectory });

  try {
    runLocalDataMigrations(connection);
    const syncRepository = new GoogleSyncRepository(connection);

    syncRepository.upsertAccountStatus({
      accountId: "acct-smoke",
      googleAccountId: "google-smoke",
      email: "smoke@example.com",
      displayName: "Smoke Account",
      avatarUrl: null,
      locale: "en-US",
      timeZone: "UTC",
      connectionState: "connected",
      grantedScopes: [
        "https://www.googleapis.com/auth/tasks",
        "https://www.googleapis.com/auth/calendar"
      ],
      missingScopes: [],
      lastAuthenticatedAt: now,
      updatedAt: now
    });
    syncRepository.writeTaskLists(
      "acct-smoke",
      [
        {
          id: "inbox",
          title: "Inbox",
          updatedAt: now
        }
      ],
      now
    );
    syncRepository.writeTasks(
      "acct-smoke",
      "inbox",
      [
        {
          id: "task-seeded",
          taskListId: "inbox",
          title: "Seeded smoke task",
          notes: "Existing local mirror row.",
          status: "needsAction",
          dueAt: now,
          deleted: false,
          hidden: false,
          updatedAt: now
        }
      ],
      {
        fullSync: true,
        now
      }
    );
    syncRepository.writeCalendarLists(
      "acct-smoke",
      [
        {
          id: "primary",
          summary: "Primary",
          timeZone: "UTC",
          isSelected: true,
          isHidden: false,
          isPrimary: true,
          updatedAt: now
        }
      ],
      now
    );
  } finally {
    connection.close();
  }
}

async function waitForAppWindow(electronApp: ElectronApplication): Promise<Page> {
  await electronApp.firstWindow();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    for (const window of electronApp.windows()) {
      if (window.isClosed()) {
        continue;
      }

      const shellVisible = await window
        .getByTestId("app-shell")
        .isVisible({ timeout: 250 })
        .catch(() => false);

      if (shellVisible) {
        return window;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Main app window did not become visible");
}

test("launches, navigates, opens command palette, and creates core items", async () => {
  let electronApp: ElectronApplication | undefined;
  const tempRoot = mkdtempSync(join(tmpdir(), "hcb2-smoke-"));
  const userDataDir = join(tempRoot, "user-data");
  const platformShortcut = process.platform === "darwin" ? "Meta" : "Control";

  try {
    seedSmokeDatabase(userDataDir);
    electronApp = await electron.launch({
      args: [resolve(__dirname, "../..")],
      env: {
        ...process.env,
        HCB_USER_DATA_DIR: userDataDir,
        NODE_ENV: "test"
      }
    });

    const page = await waitForAppWindow(electronApp);

    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.locator("#planner-title")).toHaveText("Calendar");
    const firstRunSetup = page.getByRole("dialog", { name: "First-run setup" });

    await expect(firstRunSetup).toBeVisible({ timeout: 20_000 });
    await firstRunSetup.getByRole("button", { name: "Finish setup" }).click();
    await expect(firstRunSetup).toBeHidden();

    for (const label of ["Tasks", "Calendar", "Notes"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${label}\\b`) })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Command palette" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

    for (const label of ["Tasks", "Calendar", "Notes"]) {
      await page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
      await expect(page.locator("#planner-title")).toHaveText(label);
    }

    await page.keyboard.press("Control+P");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Filter commands" }).fill("go to tasks");
    await page.keyboard.press("Enter");
    await expect(page.locator("#planner-title")).toHaveText("Tasks");

    await page.keyboard.press("Control+P");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Filter commands" }).fill("go to calendar");
    await page.keyboard.press("Enter");
    await expect(page.locator("#planner-title")).toHaveText("Calendar");

    await page.keyboard.press("Control+P");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Filter commands" }).fill("quick add");
    await page.keyboard.press("Enter");
    const quickAdd = page.getByRole("dialog", { name: "Quick add" });
    await expect(quickAdd).toBeVisible();
    await quickAdd.getByRole("textbox", { name: "Quick add text" }).fill("Smoke quick lunch tomorrow 1pm at Test Cafe");
    await quickAdd.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Event title" })).toHaveValue("Smoke quick lunch");
    await expect(page.getByRole("textbox", { name: "Event location" })).toHaveValue("Test Cafe");
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

    await page.getByRole("button", { name: "Tasks" }).click();
    await page.getByRole("button", { name: /^Seeded smoke task Existing/ }).click();
    await page.getByTestId("inspector-actions").getByRole("button", { name: "Edit" }).click();
    await page.getByRole("textbox", { name: "Task title" }).click();
    await page.keyboard.press(`${platformShortcut}+A`);
    await page.keyboard.type("Smoke UI task");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByRole("button", { name: /Smoke UI task/ }).first()).toBeVisible();

    await page.keyboard.press("Control+P");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Filter commands" }).fill("undo");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Seeded smoke task/ }).first()).toBeVisible();

    await page.keyboard.press("Control+P");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Filter commands" }).fill("redo");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Smoke UI task/ }).first()).toBeVisible();

    await page.getByRole("button", { name: /Smoke UI task/ }).first().focus();
    await page.keyboard.press(`${platformShortcut}+Z`);
    await expect(page.getByRole("button", { name: /Seeded smoke task/ }).first()).toBeVisible();
    await page.keyboard.press(`${platformShortcut}+Shift+Z`);
    await expect(page.getByRole("button", { name: /Smoke UI task/ }).first()).toBeVisible();

    await page.getByRole("button", { name: "Add a task" }).click();
    const taskTitle = page.getByRole("textbox", { name: "Task title" });
    await taskTitle.click();
    await page.keyboard.type("Native text undo");
    await expect(taskTitle).toHaveValue("Native text undo");
    await page.keyboard.press(`${platformShortcut}+Z`);
    await expect(taskTitle).toHaveValue("");
    await expect(page.getByRole("button", { name: /Smoke UI task/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: /^Calendar\b/ }).click();
    await page.getByRole("button", { name: /^New event$/ }).click();
    await page.getByRole("textbox", { name: "Event title" }).fill("Smoke UI event");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Smoke UI event" })).toBeVisible();

    await page.getByRole("button", { name: /^Notes\b/ }).click();
    await page.getByRole("button", { name: "Add a note" }).click();
    await page.getByRole("textbox", { name: "Note title" }).fill("Smoke UI note");
    await page.getByRole("textbox", { name: "Note body" }).fill("Created by smoke test.");
    await page.getByRole("textbox", { name: "Note body" }).blur();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Smoke UI note");

    const health = await page.evaluate(async () => globalThis.window.hcb?.diagnostics.health());
    expect(health?.ok).toBe(true);
    expect(health?.ok ? health.data.startup.databaseReadyMs : undefined).toBeDefined();

    const summary = await page.evaluate(async () => globalThis.window.hcb?.diagnostics.summary());
    if (!summary?.ok) {
      throw new Error(`diagnostics summary failed during smoke: ${JSON.stringify(summary)}`);
    }

    expect(summary.data.cache.taskCount).toBeGreaterThanOrEqual(1);
    expect(summary.data.native.platform).toBe(process.platform);
    expect(summary.data.native.adapterId).toBe(expectedAdapterIds[process.platform]);
    expect(summary.data.native.packageFormat).toBe("development");
    expect(summary.data.native.flags.supportsDiagnosticsCollection).toBe(true);
    expect(summary.data.redaction).toEqual({
      credentials: "redacted",
      googlePayloads: "omitted",
      mcpBearerTokens: "redacted",
      sensitiveBodies: "omitted"
    });
    expect(summary.data.native.paths.length).toBeGreaterThan(0);
    for (const path of summary.data.native.paths) {
      expect(path.redactedPath).toBeTruthy();
      expect(path.redactedPath).not.toContain("C:\\Users\\");
      expect(path.redactedPath).not.toContain("/Users/");
      expect(path.redactedPath).not.toContain("/home/");
    }
  } finally {
    await electronApp?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
