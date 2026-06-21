import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runLocalDataMigrations } from "../src/main/data/migrations";
import { createAppSqliteConnection } from "../src/main/data/sqliteConnection";
import { GoogleSyncRepository } from "../src/main/sync/readSyncRepository";

const now = "2026-05-24T00:00:00.000Z";
const screenshotDirectory = resolve("artifacts/reference-screenshots/hcb-responsive-after");

const targetSizes = [
  { key: "1440x900", width: 1440, height: 900 },
  { key: "1280x800", width: 1280, height: 800 },
  { key: "1024x768", width: 1024, height: 768 },
  { key: "768x1024", width: 768, height: 1024 },
  { key: "390x844", width: 390, height: 844 }
] as const;

const sections = ["Today", "Tasks", "Calendar"] as const;

function seedResponsiveScreenshotDatabase(appSupportDirectory: string): void {
  const connection = createAppSqliteConnection({ appSupportDirectory });

  try {
    runLocalDataMigrations(connection);
    const syncRepository = new GoogleSyncRepository(connection, { defaultTimeZone: "Asia/Singapore" });

    syncRepository.upsertAccountStatus({
      accountId: "acct-responsive",
      googleAccountId: "google-responsive",
      email: "responsive@example.com",
      displayName: "Responsive QA",
      avatarUrl: null,
      locale: "en-SG",
      timeZone: "Asia/Singapore",
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
      "acct-responsive",
      [
        {
          id: "inbox",
          title: "Inbox",
          updatedAt: now
        },
        {
          id: "launch",
          title: "Launch",
          updatedAt: now
        }
      ],
      now
    );
    syncRepository.writeTasks(
      "acct-responsive",
      "inbox",
      [
        {
          id: "task-today",
          taskListId: "inbox",
          title: "Review responsive calendar polish",
          notes: "Seeded for screenshot QA.",
          status: "needsAction",
          dueAt: "2026-05-24T09:00:00.000+08:00",
          deleted: false,
          hidden: false,
          updatedAt: now
        },
        {
          id: "task-overdue",
          taskListId: "inbox",
          title: "Triage narrow-window toolbar overflow",
          notes: "Confirms compact task rows keep actions reachable.",
          status: "needsAction",
          dueAt: "2026-05-23T18:00:00.000+08:00",
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
    syncRepository.writeTasks(
      "acct-responsive",
      "launch",
      [
        {
          id: "task-complete",
          taskListId: "launch",
          title: "Publish QA notes",
          notes: null,
          status: "completed",
          dueAt: "2026-05-24T12:00:00.000+08:00",
          completedAt: "2026-05-24T08:00:00.000+08:00",
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
      "acct-responsive",
      [
        {
          id: "primary",
          summary: "Primary",
          timeZone: "Asia/Singapore",
          backgroundColor: "#f97316",
          foregroundColor: "#ffffff",
          isSelected: true,
          isHidden: false,
          isPrimary: true,
          updatedAt: now
        },
        {
          id: "team",
          summary: "Team",
          timeZone: "Asia/Singapore",
          backgroundColor: "#3b82f6",
          foregroundColor: "#ffffff",
          isSelected: true,
          isHidden: false,
          isPrimary: false,
          updatedAt: now
        }
      ],
      now
    );
    syncRepository.writeCalendarEvents(
      "acct-responsive",
      "primary",
      [
        {
          id: "event-all-day",
          calendarId: "primary",
          status: "confirmed",
          summary: "Design QA freeze",
          startAt: "2026-05-24T00:00:00.000+08:00",
          startTimeZone: "Asia/Singapore",
          endAt: "2026-05-25T00:00:00.000+08:00",
          endTimeZone: "Asia/Singapore",
          isAllDay: true,
          updatedAt: now
        },
        {
          id: "event-review",
          calendarId: "primary",
          status: "confirmed",
          summary: "Responsive review",
          startAt: "2026-05-24T09:00:00.000+08:00",
          startTimeZone: "Asia/Singapore",
          endAt: "2026-05-24T10:00:00.000+08:00",
          endTimeZone: "Asia/Singapore",
          isAllDay: false,
          updatedAt: now
        }
      ],
      {
        fullSync: true,
        now,
        defaultTimeZone: "Asia/Singapore"
      }
    );
    syncRepository.writeCalendarEvents(
      "acct-responsive",
      "team",
      [
        {
          id: "event-team",
          calendarId: "team",
          status: "confirmed",
          summary: "Window-size smoke",
          startAt: "2026-05-25T14:00:00.000+08:00",
          startTimeZone: "Asia/Singapore",
          endAt: "2026-05-25T14:45:00.000+08:00",
          endTimeZone: "Asia/Singapore",
          isAllDay: false,
          updatedAt: now
        }
      ],
      {
        fullSync: true,
        now,
        defaultTimeZone: "Asia/Singapore"
      }
    );
  } finally {
    connection.close();
  }
}

async function finishFirstRunSetup(page: Page): Promise<void> {
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 15_000 });
  const firstRunSetup = page.getByRole("dialog", { name: "First-run setup" });

  await firstRunSetup.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);

  if (await firstRunSetup.isVisible().catch(() => false)) {
    await firstRunSetup.getByRole("button", { name: "Finish setup" }).click();
    await expect(firstRunSetup).toBeHidden();
  }

  await page.waitForTimeout(750);
  await expect(page.getByTestId("app-shell")).toBeVisible();
}

async function setElectronContentSize(
  electronApp: ElectronApplication,
  page: Page,
  size: { width: number; height: number }
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await electronApp.evaluate(({ BrowserWindow }, nextSize) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        mainWindow?.setContentSize(nextSize.width, nextSize.height);
        mainWindow?.center();
      }, size);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Execution context was destroyed") || attempt === 4) {
        throw error;
      }

      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }

  await page.setViewportSize(size).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function navigateToSection(page: Page, section: (typeof sections)[number]): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${section}\\b`) }).click();
  await expect(page.locator("#planner-title")).toHaveText(section);
}

async function captureResponsiveScreenshots(): Promise<void> {
  mkdirSync(screenshotDirectory, { recursive: true });

  let electronApp: ElectronApplication | undefined;
  const tempRoot = mkdtempSync(join(tmpdir(), "hcb-responsive-screenshots-"));
  const userDataDirectory = join(tempRoot, "user-data");

  try {
    seedResponsiveScreenshotDatabase(userDataDirectory);
    electronApp = await electron.launch({
      args: [resolve(".")],
      env: {
        ...process.env,
        HCB_USER_DATA_DIR: userDataDirectory,
        NODE_ENV: "test"
      }
    });

    const page = await electronApp.firstWindow();
    await finishFirstRunSetup(page);

    for (const size of targetSizes) {
      await setElectronContentSize(electronApp, page, size);

      for (const section of sections) {
        await navigateToSection(page, section);
        await page.screenshot({
          animations: "disabled",
          fullPage: false,
          path: join(screenshotDirectory, `${size.key}-${section.toLowerCase()}.png`)
        });
      }
    }
  } finally {
    await electronApp?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

captureResponsiveScreenshots()
  .then(() => {
    console.log(`Captured responsive screenshots in ${screenshotDirectory}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
