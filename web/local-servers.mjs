import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Observe listener metadata only: never process arguments, environment or HTTP
// responses. A listening port does not establish that an app serves HTTP.
export function parseListeners(output, owned) {
  let pid = 0, process = '';
  const servers = new Map();
  for (const line of String(output).split('\n')) {
    if (line[0] === 'p') { pid = Number(line.slice(1)); process = ''; }
    if (line[0] === 'c') process = line.slice(1).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
    if (line[0] !== 'n' || owned && !owned.has(pid) || !Number.isSafeInteger(pid) || pid <= 0 || !process) continue;
    const match = /^(?:127\.0\.0\.1|\[::1\]|\*):([0-9]{1,5})$/.exec(line.slice(1));
    const port = Number(match?.[1]);
    if (!match || port < 1 || port > 65535) continue;
    const key = pid + ':' + port;
    servers.set(key, { id: key, pid, process, port, url: 'http://127.0.0.1:' + port });
    if (servers.size >= 128) break;
  }
  return [...servers.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}

export function parseProcessTable(output) {
  const processes = new Map();
  for (const line of String(output).split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.{10,64}?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]), parent = Number(match[2]);
    if (Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(parent)) processes.set(pid, { parent, started: match[3] });
  }
  return processes;
}

export function ownedProcesses(processes, roots, previous = new Map()) {
  const owned = new Map(), rootIDs = new Set(roots);
  for (const [pid, record] of processes) {
    if (previous.get(pid) === record.started) { owned.set(pid, record.started); continue; }
    const visited = new Set();
    let current = pid;
    while (processes.has(current) && !visited.has(current)) {
      if (rootIDs.has(current)) { owned.set(pid, record.started); break; }
      visited.add(current); current = processes.get(current).parent;
    }
  }
  return owned;
}

export function localServers({ run = execute, now = Date.now, uid = process.getuid?.(), roots = () => [] } = {}) {
  let cached, pending, checked = -Infinity, rootKey = '', known = new Map();
  return async ({ fresh = false } = {}) => {
    const rootIDs = [...new Set(roots().filter(pid => Number.isSafeInteger(pid) && pid > 0))].sort((a,b) => a-b);
    const key = rootIDs.join(',');
    if (!fresh && rootKey === key && now() - checked < 5000 && cached) return cached;
    if (pending) { await pending; return fresh ? observe() : cached; }
    return observe();
    async function observe() {
      pending = (async () => {
        try {
          if (!Number.isInteger(uid)) throw new Error('unavailable');
          const options = { timeout: 2000, maxBuffer: 256 * 1024, encoding: 'utf8', windowsHide: true };
          const table = await run('ps', ['-U', String(uid), '-o', 'pid=,ppid=,lstart='], { ...options, env: { ...process.env, LC_ALL: 'C' } });
          // Start times bind provenance to a process instance. A previously
          // observed child can keep its ownership after being reparented.
          known = ownedProcesses(parseProcessTable(table.stdout), rootIDs, known);
          if (!known.size) { cached = { servers: [] }; checked = now(); rootKey = key; return cached; }
          const { stdout } = await run(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof',
            ['-nP', '-a', '-u', String(uid), '-iTCP', '-sTCP:LISTEN', '-Fpcn'], options);
          cached = { servers: parseListeners(stdout, known).filter(server => known.has(server.pid) && !rootIDs.includes(server.pid)) };
        } catch (error) {
          // Never guess ownership or retain stale listeners after discovery fails.
          cached = error.code === 1 && !error.stdout && !error.stderr ? { servers: [] }
            : { servers: [], issue: 'Local server discovery is unavailable. Agent output is still available below.' };
        }
        checked = now(); rootKey = key;
        return cached;
      })();
      try { return await pending; } finally { pending = undefined; }
    }
  };
}
