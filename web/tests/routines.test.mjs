import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './fixture.mjs';

test('routine library opens through the browser gateway without model work or draft replacement', { timeout: 20000 }, async () => {
  const app = await fixture(), abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(app.url + '/api/events', { signal: abort.signal });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    async function until(predicate) {
      while (true) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const value = JSON.parse(buffer.slice(6, end)); buffer = buffer.slice(end + 2);
          if (predicate(value)) return value;
        } else {
          const part = await reader.read(); if (part.done) throw Error('Event stream closed'); buffer += part.value;
        }
      }
    }
    const initial = await until(value => value.connection === 'connected');
    const action = async body => {
      const response = await fetch(app.url + '/api/action', { method: 'POST', headers: { Origin: app.url, 'Content-Type': 'application/json' }, body: JSON.stringify({ context: initial.context, ...body }) });
      return { status: response.status, value: await response.json() };
    };
    assert.equal((await action({ op: 'save', text: 'Keep this unsent draft.' })).status, 200);
    assert.equal((await action({ op: 'navigate', route: '/routines' })).status, 200);
    const opened = await until(value => value.state?.panel?.kind === 'routines');
    assert.equal(opened.state.panel.title, 'Skills and routines');
    assert.match(JSON.stringify(opened.state.panel), /No saved procedures yet/);
    assert.equal((await action({ op: 'draft' })).value.text, 'Keep this unsent draft.');
    assert.equal((await action({ op: 'navigate', route: '/routines', context: 'conversation:other' })).status, 409);
    assert.equal(app.payloads.length, 0);
  } finally { clearTimeout(timer); abort.abort(); await app.close(); }
});
