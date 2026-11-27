import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Observe listener metadata only: never process arguments, environment or HTTP
// responses. A listening port does not establish that an app serves HTTP.
export function parseListeners(output) {
  let pid = 0, process = '';
  const servers = new Map();
  for (const line of String(output).split('\n')) {
    if (line[0] === 'p') { pid = Number(line.slice(1)); process = ''; }
    if (line[0] === 'c') process = line.slice(1).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
    if (line[0] !== 'n' || !Number.isSafeInteger(pid) || pid <= 0 || !process) continue;
    const match = /^(?:127\.0\.0\.1|\[::1\]|\*):([0-9]{1,5})$/.exec(line.slice(1));
    const port = Number(match?.[1]);
    if (!match || port < 1 || port > 65535) continue;
    const key = pid + ':' + port;
    servers.set(key, { id: key, pid, process, port, url: 'http://127.0.0.1:' + port });
    if (servers.size >= 128) break;
  }
  return [...servers.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

export function localServers({ run = execute, now = Date.now, uid = process.getuid?.() } = {}) {
  let cached, pending, checked = -Infinity;
  return async () => {
    if (now() - checked < 5000 && cached) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        if (!Number.isInteger(uid)) throw new Error('unavailable');
        const { stdout } = await run(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof',
          ['-nP', '-a', '-u', String(uid), '-iTCP', '-sTCP:LISTEN', '-Fpcn'], { timeout: 2000, maxBuffer: 256 * 1024, encoding: 'utf8', windowsHide: true });
        cached = { servers: parseListeners(stdout).filter(server => /^(?:node(?:js)?|bun|deno|python(?:[0-9.]+)?|ruby|php|go|uvicorn|gunicorn|puma|vite|next|http-server|hot-cross-buns-runtime)$/.test(server.process)) };
      } catch (error) {
        // lsof exits 1 for no matching listeners. Never retain stale listeners
        // after an observation failure or expose command diagnostics to the UI.
        cached = error.code === 1 && !error.stdout && !error.stderr ? { servers: [] }
          : { servers: [], issue: 'Local server discovery is unavailable. Agent output is still available below.' };
      }
      checked = now();
      return cached;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
