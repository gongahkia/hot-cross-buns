import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';

// Isolated contexts and an explicitly test-mode build: no user workspace is opened.
const suppliedUrl = process.env.HCB_BENCHMARK_URL;
const output = process.env.HCB_BENCHMARK_OUTPUT ?? 'docs/performance/browser-mixed.json';
const counts = (process.env.HCB_BENCHMARK_COUNTS ?? '1000,5000').split(',').map(Number);
if (counts.some(count => !Number.isSafeInteger(count) || count < 1 || count > 50000)) throw new Error('Benchmark counts must be integers in 1..50000');
let server;
if (!suppliedUrl) {
  if (process.env.HCB_BENCHMARK_SKIP_BUILD !== '1') await build({mode: 'test', logLevel: 'warn', build: {outDir: resolve('dist-benchmark')}});
  server = await preview({build: {outDir: resolve('dist-benchmark')}, preview: {host: '127.0.0.1', port: 4176, strictPort: true}});
}
const url = suppliedUrl ?? 'http://127.0.0.1:4176';
const browser = await chromium.launch({headless: true});
const results = [];
const percentile = (values, quantile) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length * quantile) - 1)] ?? 0;
const distribution = values => ({samples: values, median: percentile(values, .5), p95: percentile(values, .95), max: Math.max(0, ...values)});
async function call(page, namespace, action, payload = {}) {
  return page.evaluate(async ({namespace, action, payload}) => {
    const result = await window.hcb[namespace][action](payload);
    if (!result.ok) throw new Error(`${namespace}.${action}: ${result.error.message}`);
    return result.data;
  }, {namespace, action, payload});
}
try {
  for (const count of counts) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.addInitScript(() => {
      window.__hcbPerf = {longTasks: [], frames: [], longTasksSupported: PerformanceObserver.supportedEntryTypes.includes('longtask')};
      if (window.__hcbPerf.longTasksSupported) new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__hcbPerf.longTasks.push({startTime: entry.startTime, duration: entry.duration});
      }).observe({type: 'longtask', buffered: true});
      let previous;
      function frame(now) { if (previous !== undefined) window.__hcbPerf.frames.push(now - previous); previous = now; requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.getByTestId('app-shell').waitFor();
    await page.waitForFunction(() => window.hcb?.__testing);
    await call(page, 'settings', 'update', {onboardingStatus: 'completed', syncMode: 'manual', defaultTimeZone: 'UTC'});
    const numbers = `WITH RECURSIVE numbers(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM numbers WHERE i<${count})`;
    const startSeed = performance.now();
    await call(page, '__testing', 'seedDatabase', {statements: [
      // Model a previously linked account with no active Google token.
      {sql: "INSERT INTO google_accounts(id,google_account_id,email,display_name,connection_state,created_at,updated_at) VALUES('bench-account','bench-subject','benchmark@example.test','Benchmark account','reauth_required','2027-01-01T00:00:00Z','2027-01-01T00:00:00Z')"},
      {sql: `${numbers} INSERT INTO tasks(id,list_id,title,notes,status,priority,tags_json,sort_order,created_at,updated_at)
        SELECT 'bench-task-'||i,'inbox','Cinnamon benchmark task '||i,'Planning detail for local workspace benchmark; notes, schedule and follow-up actions.','active','none','[]',printf('%08d',i),'2027-01-01T00:00:00Z','2027-01-01T00:00:00Z' FROM numbers`},
      {sql: `${numbers} INSERT INTO notes(id,title,body,list_id,tags_json,created_at,updated_at)
        SELECT 'bench-note-'||i,'Cinnamon benchmark note '||i,'# Research '||i||char(10)||'A mixed workspace note with full-text content, references and a realistic paragraph of local research. '||'Measurements preserve the established SQL and search index while keeping rendering independent of storage. ',(SELECT id FROM note_lists LIMIT 1),'[]','2027-01-01T00:00:00Z','2027-01-01T00:00:00Z' FROM numbers`},
      {sql: `${numbers} INSERT INTO events(id,calendar_id,title,description,starts_at,ends_at,all_day,created_at,updated_at)
        SELECT 'bench-event-'||i,'primary','Cinnamon benchmark event '||i,'Mixed workspace calendar content',strftime('%Y-%m-%dT09:00:00Z','2027-01-01','+'||(i%90)||' days'),strftime('%Y-%m-%dT10:00:00Z','2027-01-01','+'||(i%90)||' days'),0,'2027-01-01T00:00:00Z','2027-01-01T00:00:00Z' FROM numbers`}
    ]});
    const seedMs = performance.now() - startSeed;
    const startup = [];
    for (let sample = 0; sample < 3; sample++) {
      const start = performance.now();
      await page.reload();
      await page.getByTestId('app-shell').waitFor();
      await page.evaluate(async () => { const result = await window.hcb.bootstrap.get(); if (!result.ok) throw new Error(result.error.message); });
      const readyMs = performance.now() - start;
      startup.push({readyMs, ...await page.evaluate(() => ({longTasks: window.__hcbPerf.longTasks, navigation: performance.getEntriesByType('navigation')[0]?.toJSON()}))});
    }
    const cdp = await context.newCDPSession(page);
    const heapBefore = await cdp.send('Runtime.getHeapUsage');
    await page.evaluate(() => { window.__hcbPerf.longTasks = []; window.__hcbPerf.frames = []; });
    const search = [], calendar = [], edits = [];
    for (let sample = 0; sample < 5; sample++) {
      const querySample = await page.evaluate(async () => {
        const start = performance.now();
        const result = await window.hcb.search.query({query: 'cinnamon', limit: 50});
        if (!result.ok) throw new Error(result.error.message);
        return {roundTripMs: performance.now() - start, returned: result.data.items.length};
      });
      search.push(querySample);
      const calendarSample = await page.evaluate(async () => {
        const start = performance.now();
        let cursor, returned = 0, pages = 0;
        do {
          const result = await window.hcb.calendar.listEvents({start: '2027-01-01T00:00:00Z', end: '2027-02-01T00:00:00Z', limit: 500, summary: true, ...(cursor ? {cursor} : {})});
          if (!result.ok) throw new Error(result.error.message);
          returned += result.data.items.length;
          pages++;
          cursor = result.data.page.nextCursor;
        } while (cursor);
        return {roundTripMs: performance.now() - start, returned, pages};
      });
      calendar.push(calendarSample);
      let start;
      for (const [namespace, payload] of [
        ['tasks', {id: 'bench-task-1', title: `Cinnamon benchmark edited task ${sample}`}],
        ['notes', {id: 'bench-note-1', body: `# Edited research ${sample}\n${'Rich note content retained in the durable snapshot. '.repeat(20)}`}],
        ['calendar', {id: 'bench-event-1', title: `Cinnamon benchmark edited event ${sample}`}]
      ]) {
        start = performance.now();
        await call(page, namespace, 'update', payload);
        const roundTripMs = performance.now() - start;
        edits.push({namespace, roundTripMs, storage: await call(page, 'diagnostics', 'storage')});
      }
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const renderer = await page.evaluate(() => window.__hcbPerf);
    const heapAfter = await cdp.send('Runtime.getHeapUsage');
    const storage = await call(page, 'diagnostics', 'storage');
    const entry = {
      records: {tasks: count, notes: count, events: count, total: count * 3}, seedMs,
      startup: {readyMs: distribution(startup.map(item => item.readyMs)), samples: startup},
      search: {roundTripMs: distribution(search.map(item => item.roundTripMs)), samples: search},
      calendar: {roundTripMs: distribution(calendar.map(item => item.roundTripMs)), samples: calendar},
      edits: {roundTripMs: distribution(edits.map(item => item.roundTripMs)), samples: edits},
      storage,
      mainThread: {longTasksSupported: renderer.longTasksSupported, longTasks: renderer.longTasks, totalLongTaskMs: renderer.longTasks.reduce((sum,item) => sum+item.duration,0), frameGapMs: distribution(renderer.frames)},
      memory: {rendererHeapBefore: heapBefore, rendererHeapAfter: heapAfter, wasmHeapBytes: storage.wasmHeapBytes ?? null, note: 'CDP values are renderer-isolate heap/backing storage, not whole browser RSS. WASM heap is worker allocation when reported. No forced GC; these are observed high-water snapshots.'}
    };
    results.push(entry);
    console.log(JSON.stringify({records: entry.records, startupMedianMs: entry.startup.readyMs.median, searchMedianMs: entry.search.roundTripMs.median, calendarMedianMs: entry.calendar.roundTripMs.median, editMedianMs: entry.edits.roundTripMs.median, snapshotBytes: storage.bytes, mainThreadLongTaskMs: entry.mainThread.totalLongTaskMs}));
    await cdp.detach();
    await context.close();
  }
  const report = {timestamp: new Date().toISOString(), browser: browser.version(), platform: platform(), release: release(), logicalCpus: cpus().length, physicalMemoryBytes: totalmem(), dataset: 'Each size is per domain: N tasks + N notes + N events. Fresh isolated contexts. January 2027 calendar range reads all pages of 500 summaries; search returns 50 results. Query timings occur inside the browser without copying full results through the debugging protocol. Same-machine samples are observations, not performance guarantees.', results};
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Saved measured results to ${output}`);
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
