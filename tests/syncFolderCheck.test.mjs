import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRevision, revisionText, sha256 } from '../src/revisionProtocol.ts';

const execute = promisify(execFile), script = fileURLToPath(new URL('../scripts/check-sync-folder.mjs', import.meta.url));
const raw = 'UNDATED\n\nLIST: Inbox\nPrivate test-only journal text\n';
async function fixture(t, name = 'Planner.md') {
  const folder = await mkdtemp(join(tmpdir(), 'hcb-folder-check-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const history = join(folder, '.hot-cross-buns', await sha256(name)); await mkdir(history, { recursive: true });
  const record = await createRevision('file:' + name, crypto.randomUUID(), [], raw);
  await writeFile(join(folder, name), raw); await writeFile(join(history, record.id + '.json'), revisionText(record));
  return { folder, history, record, name };
}
const check = async f => execute(process.execPath, ['--experimental-strip-types', script, f.folder, f.name]);
test('folder receipts use shared validation, contain no journal text and leave files unchanged', async t => {
  const f = await fixture(t), before = await readdir(f.history);
  const result = await check(f), receipt = JSON.parse(result.stdout);
  assert.equal(receipt.history.revisions, 1); assert.deepEqual(receipt.history.heads, [f.record.id]);
  assert.equal(receipt.projection.sha256, await sha256(raw)); assert.equal(receipt.conflictCopies, 0);
  assert.ok(!result.stdout.includes('Private')); assert.deepEqual(await readdir(f.history), before);
  assert.equal(await readFile(join(f.folder, 'Planner.md'), 'utf8'), raw);
});
test('receipt identity ignores delivery order and byte-equivalent duplicate logical records', async t => {
  const f = await fixture(t), before = JSON.parse((await check(f)).stdout);
  await writeFile(join(f.history, f.record.id + ' (conflicted copy).JSON'), JSON.stringify(f.record, null, 2));
  const after = JSON.parse((await check(f)).stdout); assert.deepEqual(after, before);
});
test('an otherwise valid but incomplete branch set produces a different history fingerprint', async t => {
  const f = await fixture(t), before = JSON.parse((await check(f)).stdout);
  const child = await createRevision('file:Planner.md', f.record.device, [f.record.id], raw.replace('text', 'new text'));
  await writeFile(join(f.history, child.id + '.json'), revisionText(child));
  const after = JSON.parse((await check(f)).stdout); assert.notEqual(before.history.sha256, after.history.sha256);
  assert.equal(before.projection.sha256, after.projection.sha256);
});
test('corrupt or incomplete history fails without printing journal contents', async t => {
  const f = await fixture(t), path = join(f.history, f.record.id + '.json');
  for (const text of ['{', revisionText(f.record).replace('Private', 'Changed')]) {
    await writeFile(path, text);
    await assert.rejects(check(f), error => { assert.equal(error.stdout, ''); assert.ok(!error.stderr.includes('Private test-only')); return /incomplete|integrity/.test(error.stderr); });
  }
});
test('missing ancestors and missing history do not produce a misleading success receipt', async t => {
  const f = await fixture(t), child = await createRevision('file:Planner.md', f.record.device, [crypto.randomUUID()], raw);
  await writeFile(join(f.history, child.id + '.json'), revisionText(child));
  await assert.rejects(check(f), error => /ancestor/.test(error.stderr));
  await rm(f.history, { recursive: true }); await assert.rejects(check(f), error => error.stdout === '');
});
test('checks preserve custom journal names and count provider conflict copies separately', async t => {
  const f = await fixture(t, 'Journal.txt'); await writeFile(join(f.folder, 'Journal (conflicted copy).txt'), 'Keep this separate');
  const receipt = JSON.parse((await check(f)).stdout); assert.equal(receipt.journal, 'file:Journal.txt'); assert.equal(receipt.conflictCopies, 1);
  await assert.rejects(check({ ...f, name: '../Journal.txt' }), error => /Usage/.test(error.stderr));
});
test('the filesystem check rejects symlinked revisions', async t => {
  const f = await fixture(t), path = join(f.history, f.record.id + '.json'); await rm(path);
  await symlink(join(f.folder, 'Planner.md'), path);
  await assert.rejects(check(f), error => /symbolic links/.test(error.stderr));
});
