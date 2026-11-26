import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const usage = 'Usage: node --env-file=.env scripts/context-memory-eval.mjs --report <new.json> [--model gpt-5-mini]';
const options = { model: 'gpt-5-mini' };
try {
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--help') { console.log(usage); process.exit(0); }
    if (!['--report', '--model'].includes(process.argv[i]) || !process.argv[i + 1]) throw Error(usage);
    const flag = process.argv[i].slice(2); options[flag] = process.argv[++i];
  }
  if (!options.report || !options.model || options.model.length > 128 || /[\r\n\0]/.test(options.model)) throw Error(usage);
  if (!process.env.OPENAI_API_KEY) throw Error('Load OPENAI_API_KEY; Node.js --env-file=.env is supported.');
  const report = resolve(options.report);
  mkdirSync(dirname(report), { recursive: true, mode: 0o700 });
  const child = spawn('go', ['test', '-count=1', '-v', './cmd/hot-cross-buns', '-run', '^TestLiveDailyMemoryEvaluation$', '-timeout=30m'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, TMPDIR: realpathSync(tmpdir()), HOT_CROSS_BUNS_LIVE_DAILY_REPORT: report, HOT_CROSS_BUNS_LIVE_MEMORY_MODEL: options.model },
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
