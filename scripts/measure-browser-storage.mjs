import { chromium } from '@playwright/test';

// Run against `pnpm exec vite --mode test` (or the static test preview).
// Uses an isolated browser context, never an existing user profile.
const url = process.env.HCB_BENCHMARK_URL ?? 'http://127.0.0.1:4174';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.hcb?.__testing);
  const results = await page.evaluate(async () => {
    const api = window.hcb;
    const unwrap = result => { if (!result.ok) throw new Error(result.error.message); return result.data; };
    unwrap(await api.settings.update({ onboardingStatus: 'completed', syncMode: 'manual' }));
    const rows = [];
    for (const count of [1000, 5000, 10000]) {
      const sql = `WITH RECURSIVE numbers(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM numbers WHERE i<${count})
        INSERT OR IGNORE INTO tasks(id,list_id,title,notes,status,priority,tags_json,sort_order,created_at,updated_at)
        SELECT 'bench-'||i,'inbox','Benchmark task '||i,'Searchable cinnamon benchmark notes','active','none','[]',printf('%08d',i),datetime('now'),datetime('now') FROM numbers`;
      unwrap(await api.__testing.seedDatabase({ statements: [{ sql }] }));
      const samples = [];
      for (let sample = 0; sample < 5; sample++) {
        const start = performance.now();
        unwrap(await api.tasks.update({ id: 'bench-1', title: `Benchmark edited ${count} ${sample}` }));
        const roundTripMs = performance.now() - start;
        const metrics = unwrap(await api.diagnostics.storage());
        samples.push({ roundTripMs, exportMs: metrics.exportMs, persistMs: metrics.persistMs, loadMs: metrics.loadMs });
      }
      const metrics = unwrap(await api.diagnostics.storage());
      rows.push({ taskCount: count, bytes: metrics.bytes, samples });
    }
    return rows;
  });
  console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
  await context.close();
} finally { await browser.close(); }
