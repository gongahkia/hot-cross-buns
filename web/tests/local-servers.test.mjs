import assert from 'node:assert/strict';
import test from 'node:test';
import { localServers, parseListeners } from '../local-servers.mjs';

test('local listeners deduplicate IPv4/IPv6 and omit remote binds and process arguments', () => {
  const rows = parseListeners('p123\ncnode\nf5\nn127.0.0.1:4318\nn[::1]:4318\np124\ncworker\nn*:52239\nn192.168.1.2:9000\nn*:99999\npbad\ncunsafe\nn*:3000\n');
  assert.deepEqual(rows.map(row => [row.pid, row.process, row.port]), [[123, 'node', 4318], [124, 'worker', 52239]]);
  assert.equal(rows[0].url, 'http://127.0.0.1:4318');
});

test('listener observation coalesces requests, expires cache and bounds subprocess', async () => {
  let time = 0, calls = 0;
  const observe = localServers({ uid: 501, now: () => time, run: async (program, args, options) => {
    calls++;
    assert.ok(program.endsWith('lsof')); assert.ok(args.includes('501'));
    assert.equal(options.timeout, 2000); assert.equal(options.maxBuffer, 256 * 1024);
    assert.ok(!args.includes('-aef')); return { stdout: 'p1\ncnode\nn*:4318\n' };
  } });
  await Promise.all([observe(), observe()]); assert.equal(calls, 1);
  await observe(); assert.equal(calls, 1);
  time = 5001; await observe(); assert.equal(calls, 2);
});

test('observation failures retire stale servers and do not expose diagnostics', async () => {
  let time = 0;
  const observe = localServers({ uid: 501, now: () => time, run: async () => {
    if (!time) return { stdout: 'p1\ncnode\nn*:4318\n' };
    throw Object.assign(new Error('private command details'), { stderr: 'private data' });
  } });
  assert.equal((await observe()).servers.length, 1);
  time = 6000;
  const result = await observe(); assert.deepEqual(result.servers, []); assert.match(result.issue, /unavailable/); assert.doesNotMatch(JSON.stringify(result), /private/);
});


test('server discovery excludes operating-system and unrelated desktop listeners', async () => {
  const observe=localServers({uid:501,run:async()=>({stdout:'p1\ncnode\nn*:4318\np2\ncControlCenter\nn*:7000\np3\ncrapportd\nn*:5000\np4\nchot-cross-buns-runtime\nn*:52239\n'})});
  assert.deepEqual((await observe()).servers.map(server=>server.port),[4318,52239]);
});
