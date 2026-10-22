import { _electron as electron, expect, test as base, type Page, type ElectronApplication, type TestInfo } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const gracefulCloseMs = 10_000;
const forcedExitMs = 5_000;
type Cleanup = () => Promise<void>;
const cleanups = new Map<TestInfo, Cleanup[]>();

// A real fixture receives its own teardown deadline even when the test body
// times out. An inline finally cannot provide that guarantee.
export const test = base.extend<{ plannerLifecycle: void }>({
  plannerLifecycle: [async ({}, use, info) => {
    const registered: Cleanup[] = [];
    cleanups.set(info, registered);
    try { await use(); }
    finally {
      cleanups.delete(info);
      const failures: unknown[] = [];
      for (const cleanup of registered.reverse()) {
        try { await cleanup(); } catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, "Electron fixture cleanup failed.");
    }
  }, { auto: true, timeout: 20_000 }]
});

async function within<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

export async function planner(run: (page: Page, app: ElectronApplication) => Promise<void>) {
  const info = test.info();
  const registered = cleanups.get(info);
  if (!registered) throw new Error('Planner tests must import test from "./planner" so Electron cleanup runs after test cancellation.');
  const profile = mkdtempSync(join(tmpdir(), "hcb-workspace-ui-"));
  const started = Date.now();
  const lifecycle: string[] = [];
  const record = (message: string) => lifecycle.push(`${Date.now() - started}ms ${message}`);
  let stderr = "";
  const captureStderr = (chunk: Buffer | string) => { stderr = (stderr + chunk.toString()).slice(-65_536); };
  let application: ElectronApplication | undefined;
  let launch: Promise<ElectronApplication> | undefined;
  let processExited: Promise<void> | undefined;
  let launchSettled = false;
  const errors: string[] = [];

  async function closeApplication(app: ElectronApplication): Promise<void> {
    const child = app.process();
    record("requesting Playwright close");
    try {
      await within(app.close().then(() => processExited!), gracefulCloseMs, `Electron did not close gracefully within ${gracefulCloseMs}ms.`);
      record("Playwright close completed");
    } catch (error) {
      record(`graceful close failed: ${String(error)}`);
      if (child.exitCode === null && child.signalCode === null) {
        // Only this fixture's child is terminated. Forced exit remains a test
        // failure, even when it successfully cleans up the disposable process.
        record("forcing owned Electron process to exit");
        child.kill("SIGKILL");
        try { await within(processExited!, forcedExitMs, "Owned Electron process did not exit after SIGKILL."); }
        catch (exitError) { throw new AggregateError([error, exitError], "Electron shutdown and forced cleanup both failed.", { cause: error }); }
      }
      throw error;
    } finally {
      child.stderr?.off("data", captureStderr);
      if (child.exitCode !== null || child.signalCode !== null) rmSync(profile, { recursive: true, force: true });
      else record(`retained live process profile: ${profile}`);
    }
  }

  // Register ownership before launch; cancellation can happen during startup.
  registered.push(async () => {
    let cleanupError: unknown;
    try {
      if (launch && !launchSettled) {
        await within(launch.catch(() => undefined), 3_000, "Electron launch remained pending during fixture teardown.");
      }
      if (application) await closeApplication(application);
      else if (!launch || launchSettled) rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error;
      if (!launchSettled && launch) {
        record(`retained pending launch profile: ${profile}`);
        // Playwright normally aborts a pending launch on cancellation. If it
        // resolves late, its owned child still needs cleanup before worker exit.
        void launch.then(closeApplication, () => rmSync(profile, { recursive: true, force: true })).catch(() => undefined);
      }
    } finally {
      if (errors.length) await info.attach("renderer-errors", { body: JSON.stringify(errors, null, 2), contentType: "application/json" });
      if (info.status !== "passed" || cleanupError || process.env.HCB_TEST_LIFECYCLE === "1") {
        await info.attach("electron-lifecycle", { body: lifecycle.join("\n") + "\n\nMain-process stderr:\n" + stderr, contentType: "text/plain" });
      }
    }
    if (cleanupError) throw cleanupError;
  });
  launch = electron.launch({ args: [...(process.platform === "linux" ? ["--disable-gpu"] : []), resolve(__dirname, "../.."), `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile } }).then((app) => {
    application = app;
    const child = app.process();
    record(`launched pid=${child.pid}`);
    child.stderr?.on("data", captureStderr);
    processExited = new Promise<void>((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolveExit(); return; }
      child.once("exit", (code, signal) => { record(`process exit code=${code} signal=${signal}`); resolveExit(); });
    });
    return app;
  }).finally(() => { launchSettled = true; });
  const app = await launch;
  await app.evaluate(({ app }) => {
    const record = (message: string) => process.stderr.write(`[hcb-test-lifecycle] ${Date.now()} ${message}\n`);
    app.on("before-quit", (event) => {
      record("before-quit");
      queueMicrotask(() => record(`before-quit defaultPrevented=${event.defaultPrevented}`));
    });
    app.on("will-quit", () => record("will-quit"));
    app.on("quit", (_event, code) => record(`quit code=${code}`));
    process.on("exit", (code) => record(`process exit code=${code}`));
    process.on("uncaughtExceptionMonitor", (error) => record(`uncaught exception: ${error.stack ?? error.message}`));
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.evaluate(async () => {
    const result = await window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual", defaultTimeZone: "UTC", theme: "light", colorTheme: "hcb-neutral-light" });
    if (!result.ok) throw new Error(result.error.message);
    window.dispatchEvent(new Event("hcb:core-data-invalidated"));
  });
  await expect(page.getByRole("dialog", { name: "Hot Cross Buns", exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1180, height: 760 });
  await run(page, app);
  expect(errors).toEqual([]);
}

export const openPalette = (page: Page) => page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
export const navigate = (page: Page, section: string) => page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: section, exact: true }).click();
export async function capture(page: Page, name: string) {
  mkdirSync("output/ui-review", { recursive: true });
  await page.locator(".inspector-item-menu, .calendar-menu, .app-select-content, .date-picker").evaluateAll((menus) => Promise.all(menus.flatMap((menu) => menu.getAnimations().map((animation) => animation.finished.catch(() => undefined)))));
  await page.screenshot({ path: `output/ui-review/${name}.png` });
}
