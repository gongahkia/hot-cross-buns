import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriveApi } from '../src/googleDrive.ts';
import { createRevision, revisionText, revisionGraph } from '../src/revisionProtocol.ts';

const session = { accessToken: 'test', accountId: 'account', email: 'test@example.com', expiresAt: Date.now() + 3600_000 };
async function fixture() {
  const files = new Map(), calls = [], device = crypto.randomUUID();
  const state = { lost: false, incomplete: false, emptyFirst: false, repeated: false, oversized: false };
  const api = createDriveApi(session, async (url, init) => {
    calls.push({ url, ...init }); const address = new URL(url);
    assert.equal(init.headers.get('Authorization'), 'Bearer test'); assert.equal(init.credentials, 'omit');
    if (address.pathname.endsWith('/generateIds')) return Response.json({ ids: ['reserved-file'] });
    if (init.method === 'POST') {
      const chunks = (await init.body.text()).split('Content-Type: application/json; charset=UTF-8\r\n\r\n');
      const metadata = JSON.parse(chunks[1].split('\r\n--hcb-')[0]), raw = chunks[2].split('\r\n--hcb-')[0];
      if (files.has(metadata.id)) return new Response('', { status: 409 });
      files.set(metadata.id, { ...metadata, version: '1', size: String(Buffer.byteLength(raw)), raw });
      if (state.lost) { state.lost = false; throw new TypeError('Lost accepted reply'); }
      return Response.json({ id: metadata.id });
    }
    if (address.pathname.endsWith('/files')) {
      assert.match(address.searchParams.get('q'), /hcbJournal/);
      const metadata = [...files.values()].map(({ raw, ...file }) => state.oversized ? { ...file, size: String(65 * 1024 * 1024) } : file);
      if (state.emptyFirst && !address.searchParams.has('pageToken')) return Response.json({ files: [], nextPageToken: 'next' });
      return Response.json({ files: metadata, incompleteSearch: state.incomplete, ...(state.repeated ? { nextPageToken: 'next' } : {}) });
    }
    const file = files.get(address.pathname.split('/').at(-1));
    return file ? new Response(file.raw) : new Response('', { status: 404 });
  });
  return { files, calls, state, transport: api.revisions('journal-file', async () => device), record: await createRevision('drive:journal-file', device, [], 'UNDATED\n\nLIST: Inbox\nItem\n') };
}

test('reserved Drive identities survive lost replies; retry verifies 409 without another file', async () => {
  const { files, calls, state, transport, record } = await fixture();
  const id = await transport.reserve(); state.lost = true;
  await assert.rejects(transport.put(record, id), /Lost accepted/);
  await transport.put(record, id); assert.equal(files.size, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
  assert.equal((await transport.list())[0].digest, record.digest);
  await assert.rejects(transport.put(record), /not saved before dispatch/);
});
test('Drive history follows empty pages and rejects incomplete or looping listings', async () => {
  const { transport, record, state } = await fixture(); await transport.put(record, await transport.reserve());
  state.emptyFirst = true; assert.equal((await transport.list()).length, 1);
  state.incomplete = true; await assert.rejects(transport.list(), /incomplete history/);
  state.incomplete = false; state.repeated = true; await assert.rejects(transport.list(), /repeated a history page/);
});
test('duplicate filenames are not identities; identical logical copies coalesce by revision identity', async () => {
  const { files, transport, record } = await fixture(); await transport.put(record, await transport.reserve());
  const copy = structuredClone(files.values().next().value); copy.id = 'another-file'; files.set(copy.id, copy);
  const listed = await transport.list(); assert.equal(listed.length, 2);
  assert.equal((await revisionGraph(listed, 'drive:journal-file')).stats.count, 1);
});
test('Drive rejects altered bodies, mismatched identities and oversized listings', async () => {
  const { files, transport, record, state } = await fixture(); await transport.put(record, await transport.reserve());
  const file = files.values().next().value;
  file.raw = revisionText(record).replace('Item', 'Changed'); file.version = '2';
  await assert.rejects(transport.list(), /integrity/);
  file.raw = revisionText(record); file.version = '3'; file.appProperties.hcbRevision = 'different';
  await assert.rejects(transport.list(), /does not match/);
  file.appProperties.hcbRevision = record.id; state.oversized = true;
  await assert.rejects(transport.list(), /limit/);
});
