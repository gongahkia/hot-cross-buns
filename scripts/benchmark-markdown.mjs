import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { parseMarkdownPlanner } from '../src/markdownPlanner.ts';
import { incrementalTitleExperiment, sourceDelta } from './experiments/markdownIncremental.ts';
import { benchmarkPlanner } from './markdown-benchmark-fixture.mjs';

const countArg = process.argv.find(arg => arg.startsWith('--samples='));
const samples = Number(countArg?.slice('--samples='.length) ?? 3);
if (!Number.isInteger(samples) || samples < 1 || samples > 10 || process.argv.slice(2).some(arg => !arg.startsWith('--samples='))) throw new Error('Use --samples=1 through --samples=10.');
const port = Number(process.env.HCB_MARKDOWN_BENCHMARK_PORT ?? 4187);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid benchmark port.');
const output = path.resolve('.tmp/markdown-benchmark/latest.json');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? null, p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null, maxMs: sorted.at(-1) ?? null };
};
const phases = measurements => Object.fromEntries([...new Set(measurements.map(item => item.phase))].sort().map(phase => [phase, summary(measurements.filter(item => item.phase === phase).map(item => item.milliseconds))]));
const run = (cmd, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: 'inherit', env });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}.`)));
});
const report = { generatedAt: new Date().toISOString(), environment: { node: process.version, platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, browser: '', samples, profiling: true, visibleEntries: 20 }, datasets: [], notes: [
  'React measurements use the production profiling build and include its instrumentation overhead.',
  'Worker echo round trips include structured cloning, scheduling and both directions; they are not pure copy CPU time.',
  'Durable save includes opening IndexedDB, validation, serialization and the completed transaction.',
  'The incremental-title implementation is a benchmark-only experiment; production retains full validation.',
  'No Obsidian/Notion or physical-device speed comparison is established by this benchmark.',
] };
let server, browser, profilingBuilt = false;
try {
  await run('npm', ['run', 'build'], { ...process.env, VITE_HCB_MARKDOWN_PROFILE: '1' });
  profilingBuilt = true;
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let serverError = '';
  server.stderr.on('data', data => { serverError += String(data); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`Benchmark server exited: ${serverError}`);
    try { if ((await fetch(base)).ok) break; } catch { /* wait for this server's first response. */ }
    if (attempt > 100) throw new Error('Benchmark server did not start.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const asset = (await readdir('dist/assets')).find(name => /^journalWorkerEntry-.*\.js$/.test(name));
  if (!asset) throw new Error('The production journal worker is missing.');
  browser = await chromium.launch(); report.environment.browser = browser.version();
  for (const size of [1000, 10000]) {
    console.log(`Measuring ${size.toLocaleString()} entries with 20 visible rows…`);
    const nodeParse = [], incremental = [], fullTitle = [], extraction = [], measurements = [], transfers = [];
    let fixture = benchmarkPlanner(size, today), reference = parseMarkdownPlanner(fixture);
    for (let sample = 0; sample < samples; sample++) {
      global.gc?.();
      let started = performance.now(); reference = parseMarkdownPlanner(fixture); nodeParse.push(performance.now() - started);
      const entry = reference.days[0].entries[0], patch = { range: entry.titleRange, expected: entry.markdown, text: 'Historical task' };
      started = performance.now(); const fast = incrementalTitleExperiment(reference, patch); incremental.push(performance.now() - started);
      assert.ok(fast); started = performance.now(); const complete = parseMarkdownPlanner(fast.source); fullTitle.push(performance.now() - started);
      assert.deepEqual(fast, complete);
      started = performance.now(); const delta = sourceDelta(fixture, fast.source); extraction.push(performance.now() - started);
      assert.equal(fixture.slice(0, delta.range.start) + delta.text + fixture.slice(delta.range.end), fast.source);

      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Asia/Singapore', reducedMotion: 'reduce' });
      try {
        await context.addInitScript(() => { window.__hcbMarkdownMetrics = { enabled: true, samples: [] }; });
        const page = await context.newPage();
        await page.goto(base); await page.getByRole('textbox', { name: 'New daily item', exact: true }).waitFor();
        if (!await page.evaluate(() => window.__hcbMarkdownMetrics.samples.some(sample => sample.phase === 'reactRender'))) throw new Error('React profiling is unavailable; do not report ordinary production renders as profiled.');
        await page.evaluate(() => { window.__hcbMarkdownMetrics.samples = []; });
        fixture = benchmarkPlanner(size, today, sample);
        await page.getByLabel('Import a Planner.md file').setInputFiles({ name: 'Planner.md', mimeType: 'text/markdown', buffer: Buffer.from(fixture) });
        await page.getByRole('button', { name: 'Complete Visible task 0', exact: true }).waitFor({ timeout: 30000 });
        await page.waitForFunction(() => window.__hcbMarkdownMetrics.samples.some(sample => sample.phase === 'durableSave'), { timeout: 30000 });
        measurements.push(...(await page.evaluate(() => window.__hcbMarkdownMetrics.samples)).map(item => ({ ...item, phase: `import:${item.phase}` })));
        await page.evaluate(() => { window.__hcbMarkdownMetrics.samples = []; });
        await page.getByRole('button', { name: 'Complete Visible task 0', exact: true }).click();
        await page.waitForFunction(() => window.__hcbMarkdownMetrics.samples.some(sample => sample.phase === 'durableSave'), { timeout: 30000 });
        measurements.push(...(await page.evaluate(() => window.__hcbMarkdownMetrics.samples)).map(item => ({ ...item, phase: `completion:${item.phase}` })));
        transfers.push(await page.evaluate(async ({ source, asset }) => {
          const worker = new Worker(`/assets/${asset}`, { type: 'module' });
          const ask = request => new Promise((resolve, reject) => { worker.onerror = () => reject(new Error('Benchmark parser worker failed.')); worker.onmessage = event => event.data.ok ? resolve(event.data) : reject(new Error(event.data.error)); worker.postMessage(request); });
          const coldStart = performance.now(); await ask({ id: 1, kind: 'parse', source: 'not a planner', profile: true }); const startupMs = performance.now() - coldStart;
          const started = performance.now(); const parsed = await ask({ id: 2, kind: 'parse', source, profile: true }); const parseRoundTripMs = performance.now() - started;
          worker.terminate();
          const blob = URL.createObjectURL(new Blob(['onmessage = event => postMessage(event.data)'], { type: 'text/javascript' }));
          const echo = new Worker(blob), sourceTimes = [], modelTimes = [], deltaTimes = [];
          const copy = value => new Promise((resolve, reject) => { const start = performance.now(); echo.onerror = () => reject(new Error('Benchmark echo failed.')); echo.onmessage = () => resolve(performance.now() - start); echo.postMessage(value); });
          try {
            await copy('warmup');
            for (let index = 0; index < 3; index++) { sourceTimes.push(await copy(source)); modelTimes.push(await copy(parsed.model)); deltaTimes.push(await copy({ revision: 1, range: { start: 1, end: 2 }, expected: 'x', text: 'y' })); }
          } finally { echo.terminate(); URL.revokeObjectURL(blob); }
          return { startupMs, parseRoundTripMs, workerParseMs: parsed.workerMs, sourceEchoMs: sourceTimes, modelEchoMs: modelTimes, deltaEchoMs: deltaTimes, modelSerializedCharacters: JSON.stringify(parsed.model).length };
        }, { source: fixture, asset }));
      } finally { await context.close(); }
    }
    report.datasets.push({ entries: size, sourceBytes: Buffer.byteLength(fixture), sourceLines: fixture.split('\n').length - 1, nodeParse: summary(nodeParse), ui: phases(measurements), worker: {
      coldStartup: summary(transfers.map(item => item.startupMs)), fullParse: summary(transfers.map(item => item.workerParseMs)), parseRoundTrip: summary(transfers.map(item => item.parseRoundTripMs)), sourceEcho: summary(transfers.flatMap(item => item.sourceEchoMs)), modelEcho: summary(transfers.flatMap(item => item.modelEchoMs)), deltaEcho: summary(transfers.flatMap(item => item.deltaEchoMs)), modelSerializedCharacters: transfers[0].modelSerializedCharacters,
    }, experiments: { fullTitleParse: summary(fullTitle), incrementalTitle: summary(incremental), deltaExtraction: summary(extraction), fullModelEquivalenceSamples: samples } });
  }
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Benchmark report: ${output}`);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await exited; }
  if (profilingBuilt) await run('npm', ['run', 'build'], { ...process.env, VITE_HCB_MARKDOWN_PROFILE: '0' });
}
