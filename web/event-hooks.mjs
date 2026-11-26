import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const validID = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
const equal = (a, b) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Keys are private host data. They never enter native task arguments, SSE,
// transcripts, model tool results or URLs. Only an explicit enable returns one.
export function eventHooks(host, { now = Date.now, enqueue = nativeEnqueue } = {}) {
  const file = join(host.backendStateRoot, 'hot-cross-buns', 'event-hooks.json');
  const reviews = new Map(); let tail = Promise.resolve(), active = 0;
  async function read() {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > 1024 * 1024) throw Error('Event endpoint storage is invalid.');
      const value = JSON.parse(await handle.readFile('utf8'));
      if (value.version !== 1 || !Array.isArray(value.hooks) || value.hooks.length > 128 || value.hooks.some(h => !validID(h.id) || !/^[a-f0-9]{64}$/.test(h.policy) || !/^[a-f0-9]{64}$/.test(h.key))) throw Error('Event endpoint storage is invalid.');
      return value;
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, hooks: [] }; throw error; }
    finally { await handle?.close(); }
  }
  async function write(value) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const path = file + '.' + randomUUID(), handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); await handle.close(); await rename(path, file); }
    finally { await handle.close().catch(() => {}); await rm(path, { force: true }); }
  }
  const task = id => host.backend?.state?.checks?.find(value => value.id === id && value.kind === 'event');
  async function manage(body) {
    host.mutable();
    if (!validID(body.id) || !['status', 'review', 'enable', 'disable'].includes(body.action)) throw Error('Choose an event-triggered task.');
    const value = await read(), hook = value.hooks.find(item => item.id === body.id);
    if (body.action === 'disable') { value.hooks = value.hooks.filter(item => item.id !== body.id); await write(value); return { enabled: false }; }
    const current = task(body.id);
    if (!current || !current.enabled || current.state === 'ended') throw Error('Refresh and select an enabled event-triggered task.');
    if (body.action === 'status') return { enabled: hook?.policy === current.digest, path: '/events/' + body.id, title: current.title, timing: current.timing };
    if (body.action === 'review') {
      if (reviews.size >= 32) reviews.clear();
      const nonce = randomUUID(); reviews.set(nonce, { id: body.id, policy: current.digest, context: host.context, expires: now() + 300000 });
      return { review: nonce, title: current.title, timing: current.timing, effect: 'Authenticated matching events can queue this exact reviewed task. Events grant no additional account, file or external-action permissions.' };
    }
    const review = reviews.get(body.review); reviews.delete(body.review);
    if (!review || review.id !== body.id || review.policy !== current.digest || review.context !== host.context || review.expires <= now()) throw Error('The endpoint review changed. Review the current task again.');
    const key = randomBytes(32).toString('hex');
    value.hooks = value.hooks.filter(item => item.id !== body.id);
    if (value.hooks.length >= 128) throw Error('Too many event endpoints.');
    value.hooks.push({ id: body.id, policy: current.digest, key }); await write(value);
    return { enabled: true, path: '/events/' + body.id, key };
  }
  return {
    manage(body) { const result = tail.then(() => manage(body)); tail = result.catch(() => {}); return result; },
    async deliver(id, headers, raw) {
      if (!validID(id) || raw.length > 18000 || active >= 4) throw Error('Event request is unavailable or exceeds its limit.');
      const value = await read(), hook = value.hooks.find(item => item.id === id);
      if (!hook) throw Error('Event endpoint is disabled.');
      const timestamp = headers['x-hcb-timestamp'], delivery = headers['x-hcb-event-id'], signature = headers['x-hcb-signature'];
      if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(now() - Number(timestamp) * 1000) > 300000 || typeof delivery !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(delivery)) throw Error('Invalid event authentication.');
      const expected = createHmac('sha256', hook.key).update(timestamp + '.' + delivery + '.').update(raw).digest('hex');
      if (!equal(signature, expected)) throw Error('Invalid event authentication.');
      let payload; try { payload = JSON.parse(raw); } catch { throw Error('Invalid event payload.'); }
      if (typeof payload.type !== 'string' || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw Error('Use an event type and an object of event data.');
      active++;
      try { return await enqueue(host, { job_id: id, policy: hook.policy, delivery, type: payload.type, data: payload.data }); }
      finally { active--; }
    },
  };
}

function nativeEnqueue(host, body) {
  return new Promise((resolve, reject) => {
    const child = spawn(host.binary, ['job', 'event-input'], { cwd: host.workspace, env: { ...host.env, HOT_CROSS_BUNS_STATE_DIR: host.backendStateRoot }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); }, 10000); timer.unref();
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 4096) { failed = true; child.kill(); } });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0 || failed) return reject(Error('Event was not queued. Refresh the task and its endpoint agreement.')); try { resolve(JSON.parse(output)); } catch { reject(Error('Event delivery was not confirmed.')); } });
    child.stdin.end(JSON.stringify(body));
  });
}
