import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const usage = 'Usage: node --env-file=.env scripts/memory-eval.mjs --suite focused|journey|maintenance --report <new.json> [--model gpt-5-mini]';
const options = { suite: 'journey', model: 'gpt-5-mini' };
try {
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === '--help') { console.log(usage); process.exit(0); }
    if (!['--suite', '--report', '--model'].includes(flag) || !process.argv[i + 1]) throw Error(usage);
    options[flag.slice(2)] = process.argv[++i];
  }
  if (!['focused', 'journey', 'maintenance'].includes(options.suite) || !options.report || options.model.length > 128 || /[\r\n\0]/.test(options.model)) throw Error(usage);
  if (!process.env.OPENAI_API_KEY) throw Error('Load OPENAI_API_KEY into the process environment; --env-file=.env is supported by Node.js.');
  const report = resolve(options.report);
  mkdirSync(dirname(report), { recursive: true, mode: 0o700 });
  const name = options.suite === 'maintenance' ? 'TestLiveSummaryMaintenance' : options.suite === 'journey' ? 'TestLiveMemoryJourney' : 'TestLiveMemoryEvaluation';
  const child = spawn('go', ['test', '-count=1', '-v', './cmd/hot-cross-buns', '-run', '^' + name + '$'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, TMPDIR: realpathSync(tmpdir()), HOT_CROSS_BUNS_LIVE_MEMORY_REPORT: report, HOT_CROSS_BUNS_LIVE_MAINTENANCE_REPORT: options.suite === 'maintenance' ? report : '',
      HOT_CROSS_BUNS_LIVE_MEMORY_PROVIDER: 'openai', HOT_CROSS_BUNS_LIVE_MEMORY_MODEL: options.model },
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
