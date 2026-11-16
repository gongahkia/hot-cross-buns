import assert from 'node:assert/strict';
import test from 'node:test';
import { createDriveApi, GoogleDriveError, validateDriveFile } from '../src/googleDrive.ts';
import { validateGoogleConfig } from '../src/googleAuth.ts';

const session = { accessToken: 'test-token', expiresAt: Date.now() + 3_600_000, accountId: 'account-1', email: 'test@example.com' };
const file = { id: 'file-1', name: 'Planner.md', version: '1', mimeType: 'text/plain', capabilities: { canEdit: true } };
const link = { fileId: file.id, version: '1', baselineText: 'Original\n' };
function server({ text = 'Original\n', etag = '"revision-1"', failSave = 0, mutate } = {}) {
  let version = 1;
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, ...init });
    const address = new URL(url);
    if (init.method === 'PATCH') {
      if (failSave) return new Response('', { status: failSave });
      text = init.body; version++;
      return Response.json({ ...file, version: String(version) });
    }
    if (mutate) { const next = mutate(calls.length); if (next) { text = next.text; version = next.version; } }
    if (address.searchParams.get('alt') === 'media') return new Response(text);
    return Response.json({ ...file, version: String(version) }, { headers: etag ? { ETag: etag } : {} });
  };
  return { api: createDriveApi(session, fetcher), calls, text: () => text };
}

test('Drive reads use a bearer header and stable-version checks, without cookies or token URLs', async () => {
  const remote = server();
  const snapshot = await remote.api.read(file.id);
  assert.equal(snapshot.text, 'Original\n'); assert.equal(snapshot.etag, '"revision-1"');
  assert.equal(remote.calls.length, 3);
  for (const call of remote.calls) {
    assert.equal(call.headers.get('Authorization'), 'Bearer test-token');
    assert.equal(call.credentials, 'omit'); assert.equal(call.cache, 'no-store');
    assert.equal(call.url.includes(session.accessToken), false);
  }
});
test('a changing remote file is reread and bounded retries reject an unstable snapshot', async () => {
  const remote = server({ mutate: count => count === 3 ? { text: 'Changed\n', version: 2 } : null });
  assert.equal((await remote.api.read(file.id)).text, 'Changed\n');
  assert.equal(remote.calls.length, 6);
  const unstable = server({ mutate: count => ({ text: String(count), version: count }) });
  await assert.rejects(unstable.api.read(file.id), /kept changing/);
  assert.equal(unstable.calls.length, 9);
});
test('external changes pause a save rather than overwriting the remote contents', async () => {
  const remote = server({ text: 'From another device\n' });
  assert.equal((await remote.api.save(link, 'Local edit\n')).kind, 'changed');
  assert.equal(remote.calls.some(call => call.method === 'PATCH'), false);
  assert.equal(remote.text(), 'From another device\n');
});
test('identical local and remote contents acknowledge a newer revision without an upload', async () => {
  const remote = server({ text: 'Local edit\n', mutate: () => ({ text: 'Local edit\n', version: 2 }) });
  const result = await remote.api.save(link, 'Local edit\n');
  assert.equal(result.kind, 'unchanged'); assert.equal(result.snapshot.file.version, '2');
  assert.equal(remote.calls.length, 3);
});
test('a save sends the full text and uses a provider-supplied strong ETag when available', async () => {
  const remote = server();
  const saved = await remote.api.save(link, 'Local edit\n');
  assert.equal(saved.kind, 'saved'); assert.equal(saved.snapshot.file.version, '2');
  assert.equal(remote.calls[3].headers.get('If-Match'), '"revision-1"');
  assert.equal(remote.calls[3].body, 'Local edit\n');
  for (const etag of [null, 'W/"weak"']) {
    const noTag = server({ etag }); await noTag.api.save(link, 'Local edit\n');
    assert.equal(noTag.calls[3].headers.has('If-Match'), false);
  }
});
test('conditional failures and rate limits are surfaced without blindly retrying uploads', async () => {
  for (const status of [401, 403, 404, 412, 429, 503]) {
    const remote = server({ failSave: status });
    await assert.rejects(remote.api.save(link, 'Local edit\n'), error => error instanceof GoogleDriveError && error.status === status);
    assert.equal(remote.calls.filter(call => call.method === 'PATCH').length, 1);
  }
});
test('expired sessions fail before sending a request', async () => {
  const api = createDriveApi({ ...session, expiresAt: Date.now() + 10_000 }, () => assert.fail('expired token sent'));
  await assert.rejects(api.read(file.id), error => error.status === 401);
});
test('Drive rejects non-text, read-only, trashed, oversized and malformed metadata', async () => {
  for (const change of [{ mimeType: 'application/vnd.google-apps.document' }, { capabilities: { canEdit: false } }, { trashed: true }, { size: String(5 * 1024 * 1024 + 1) }, { version: 'invalid' }]) {
    assert.throws(() => validateDriveFile({ ...file, ...change }));
  }
  assert.equal(validateDriveFile({ ...file, mimeType: 'application/octet-stream' }).id, file.id);
  const malformed = createDriveApi(session, async () => Response.json({ ...file, id: 'different-file' }));
  await assert.rejects(malformed.read(file.id), /different file/);
  let calls = 0;
  const invalidUtf8 = createDriveApi(session, async url => { calls++; return url.includes('alt=media') ? new Response(new Uint8Array([0xc0, 0xaf])) : Response.json(file); });
  await assert.rejects(invalidUtf8.read(file.id), /encoded data|encoding/i); assert.equal(calls, 2);
});
test('creating Planner.md includes the complete UTF-8 journal in a single multipart request', async () => {
  let upload;
  const api = createDriveApi(session, async (url, init) => { upload = { url, ...init }; return Response.json(file); });
  const text = 'UNDATED\n\nLIST: Inbox\n你好 🍞\n- Detail\n';
  const created = await api.create(text);
  assert.equal(created.text, text); assert.equal(upload.method, 'POST');
  assert.match(upload.url, /uploadType=multipart/); assert.match(upload.body.type, /multipart\/related; boundary=hcb-/);
  const body = await upload.body.text(); assert.ok(body.includes(text)); assert.ok(body.includes('"name":"Planner.md"'));
});
test('recent app-authorized files exclude read-only and oversized entries', async () => {
  const api = createDriveApi(session, async url => {
    assert.match(new URL(url).searchParams.get('q'), /mimeType = 'text\/plain'/);
    return Response.json({ files: [file, { ...file, id: 'readonly', capabilities: { canEdit: false } }, { ...file, id: 'huge', size: '6000000' }] });
  });
  assert.deepEqual((await api.list()).map(item => item.id), ['file-1']);
});
test('browser configuration validates public Web OAuth and Picker values', () => {
  const valid = { clientId: '123-test.apps.googleusercontent.com', apiKey: 'test-key', projectNumber: '123' };
  assert.deepEqual(validateGoogleConfig({ ...valid, clientId: ' ' + valid.clientId + ' ' }), valid);
  assert.throws(() => validateGoogleConfig({ ...valid, clientId: 'not-an-oauth-client' }), /Web OAuth/);
  assert.throws(() => validateGoogleConfig({ ...valid, projectNumber: 'project-name' }), /digits/);
});
