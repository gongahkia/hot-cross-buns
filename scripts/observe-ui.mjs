import { open, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Read only: observe the same event stream as the browser without issuing actions.
const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:4317' },
  output: { type: 'string' },
  seconds: { type: 'string', default: '30' },
  once: { type: 'boolean', default: false },
  content: { type: 'boolean', default: false },
} });
const base = new URL(values.url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password) {
  throw Error('Choose a local HTTP HCB instance without URL credentials.');
}
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600 || !values.output) {
  throw Error('Specify --output and --seconds between 1 and 3600. Raw content requires --content.');
}
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const file = await open(output, 'wx', 0o600);
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), seconds * 1000);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
let count = 0;
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
        at: new Date().toISOString(), context: snapshot.context, connection: snapshot.connection,
        conversation: state.conversation_id, primary: state.primary, model: state.model,
        running: state.running, working: state.working, needsApproval: state.needsApproval,
        messages: state.messages?.length, dialogue: state.dialogue?.length,
        activity: state.activity, tasks: snapshot.tasks, helpers: snapshot.helpers,
        scheduled: snapshot.scheduled, issue: snapshot.issue,
      };
      await file.write(JSON.stringify(values.content ? { ...summary, snapshot } : summary) + '\n');
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
console.log(JSON.stringify({ snapshots: count, output, rawContentIncluded: values.content }));
