import { _electron as electron } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, freemem, loadavg, release, tmpdir, totalmem } from "node:os";
import { basename, join, resolve } from "node:path";

const runs = Number(process.env.HCB_STARTUP_RUNS ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("HCB_STARTUP_RUNS must be between 1 and 20.");
const executablePath = process.env.HCB_STARTUP_EXECUTABLE;
const output = resolve("artifacts/perf");
const samples: unknown[] = [];

async function launch(profile: string, mode: "fresh" | "cached", noteId?: string) {
  const started = performance.now();
  const app = await electron.launch({
    ...(executablePath ? { executablePath, args: [`--user-data-dir=${profile}`] } : { args: [resolve("."), `--user-data-dir=${profile}`] }),
    env: { ...process.env, NODE_ENV: "test", HCB_TEST_DATABASE_ROOT: profile }
  });
  const connectedMs = performance.now() - started;
  try {
    const page = await app.firstWindow();
    const firstWindowMs = performance.now() - started;
    await page.getByTestId("app-shell").waitFor({ state: "visible", timeout: 60_000 });
    const shellVisibleMs = performance.now() - started;
    const observedHealth = await page.waitForFunction(async () => {
      const health = await window.hcb?.diagnostics.health({});
      return health?.ok && health.data.startup.shellVisibleMs !== undefined ? health : false;
    });
    const health = await observedHealth.jsonValue() as Awaited<ReturnType<NonNullable<Window["hcb"]>["diagnostics"]["health"]>>;
    await observedHealth.dispose();
    if (!health.ok) throw new Error(health.error.message);
    const renderer = await page.evaluate(() => ({
      nowMs: performance.now(),
      navigation: performance.getEntriesByType("navigation").map((entry) => entry.toJSON()),
      scripts: performance.getEntriesByType("resource").filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script")
        .map((entry) => ({ file: entry.name.split("/").at(-1), durationMs: entry.duration, startTime: entry.startTime })),
      // file:// resource timing can be empty in Electron. Retain the actual
      // script and preload elements without pretending they are timing entries.
      scriptElements: Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map((element) => element.src.split("/").at(-1)),
      modulePreloads: Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')).map((element) => element.href.split("/").at(-1))
    }));
    const sample = { mode, connectedMs, firstWindowMs, shellVisibleMs, startup: health.data.startup, renderer,
      load: loadavg(), freeMemoryMiB: Math.round(freemem() / 1048576) };
    samples.push(sample);
    console.log(JSON.stringify(sample));
    if (mode === "fresh") {
      const setup = await page.evaluate(() => window.hcb!.settings.update({ onboardingStatus: "skipped", syncMode: "manual" }));
      if (!setup.ok) throw new Error(setup.error.message);
      const note = await page.evaluate(() => window.hcb!.notes.create({ title: "Startup persistence probe", body: "Local profiling fixture" }));
      if (!note.ok) throw new Error(note.error.message);
      return note.data.id;
    }
    const note = await page.evaluate((id) => window.hcb!.notes.get({ id: id! }), noteId);
    if (!note.ok || note.data.body !== "Local profiling fixture") throw new Error("Cached startup lost the fixture note.");
    return noteId!;
  } finally { await app.close(); }
}

async function main() {
  try {
    for (let index = 0; index < runs; index += 1) {
      const profile = mkdtempSync(join(tmpdir(), "hcb-startup-profile-"));
      try { const id = await launch(profile, "fresh"); await launch(profile, "cached", id); }
      finally { rmSync(profile, { force: true, recursive: true }); }
    }
  } finally {
    mkdirSync(output, { recursive: true });
    const report = { generatedAt: new Date().toISOString(), executable: executablePath ? basename(executablePath) : "development Electron", runs,
      environment: { platform: process.platform, osRelease: release(), logicalCpus: cpus().length, totalMemoryMiB: Math.round(totalmem() / 1048576) }, samples };
    const content = JSON.stringify(report, null, 2) + "\n";
    writeFileSync(join(output, "startup-latest.json"), content);
    writeFileSync(join(output, `startup-${Date.now()}.json`), content);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
