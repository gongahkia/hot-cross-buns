import { open, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Read only: observe the same event stream as the browser without issuing actions.
const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:4317' },
  output: { type: 'string' },
  seconds: { type: 'string', default: '30' },
  'max-mib': { type: 'string', default: '64' },
  once: { type: 'boolean', default: false },
  content: { type: 'boolean', default: false },
} });
const base = new URL(values.url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password) {
  throw Error('Choose a local HTTP HCB instance without URL credentials.');
}
const seconds = Number(values.seconds);
const maxMiB = Number(values['max-mib']);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600 || !values.output || !Number.isInteger(maxMiB) || maxMiB < 1 || maxMiB > 1024) {
  throw Error('Specify --output, --seconds between 1 and 3600, and --max-mib between 1 and 1024. Raw content requires --content.');
}
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const file = await open(output, 'wx', 0o600);
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), seconds * 1000);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
let count = 0, written = 0, previous;
try {
  const response = await fetch(new URL('/api/events', base), { signal: abort.signal });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw Error(`HCB event stream unavailable (${response.status}).`);
  }
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length > 16 * 1024 * 1024) throw Error('Event stream exceeded the observation bound.');
    let boundary;
    while ((boundary = pending.indexOf('\n\n')) !== -1) {
      const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
      const data = event.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
      if (!data) continue;
      const snapshot = JSON.parse(data), state = snapshot.state || {};
      const summary = {
        context: snapshot.context, connection: snapshot.connection,
        conversation: state.conversation_id, primary: state.primary, model: state.model,
        running: state.running, working: state.working, needsApproval: state.needsApproval,
        messages: state.messages?.length, dialogue: state.dialogue?.length,
        activity: state.activity, tasks: snapshot.tasks, helpers: snapshot.helpers,
        scheduled: snapshot.scheduled, issue: snapshot.issue,
      };
      const record = values.content ? { ...summary, snapshot } : summary;
      const signature = JSON.stringify(record);
      if (signature === previous) continue;
      const line = JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n';
      const size = Buffer.byteLength(line);
      if (written + size > maxMiB * 1024 * 1024) throw Error('Observation log size limit reached; earlier records are preserved.');
      await file.write(line); written += size; previous = signature;
      count++;
      if (values.once) { abort.abort(); break; }
    }
    if (values.once && count) break;
  }
} catch (error) {
  if (!abort.signal.aborted) throw error;
} finally {
  clearTimeout(timer); await file.close();
}
if (!count) throw Error('No HCB state received; inspect connection before testing.');
console.log(JSON.stringify({ snapshots: count, bytes: written, output, rawContentIncluded: values.content }));
