import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { localServers, parseListeners, parseProcessTable, ownedProcesses } from '../local-servers.mjs';

const started = 'Fri Nov 27 10:00:00 2026';
const table = entries => entries.map(([pid,parent,time=started]) => `${pid} ${parent} ${time}`).join('\n');

test('local listeners deduplicate IPv4/IPv6 and omit remote binds and process arguments', () => {
  const rows = parseListeners('p123\ncnode\nf5\nn127.0.0.1:4318\nn[::1]:4318\np124\ncworker\nn*:52239\nn192.168.1.2:9000\nn*:99999\npbad\ncunsafe\nn*:3000\n');
  assert.deepEqual(rows.map(row => [row.pid, row.process, row.port]), [[123, 'node', 4318], [124, 'worker', 52239]]);
  assert.equal(rows[0].url, 'http://127.0.0.1:4318');
});

test('ownership follows runtime ancestry and retains only the same observed process after reparenting', () => {
  const first = ownedProcesses(parseProcessTable(table([[10,1],[11,10],[12,11],[50,1],[51,50],[60,61],[61,60]])),[10]);
  assert.deepEqual([...first.keys()],[10,11,12]);
  const later = ownedProcesses(parseProcessTable(table([[12,1],[11,50,'Fri Nov 27 10:01:00 2026'],[51,50]])),[],first);
  assert.deepEqual([...later.keys()],[12]);
  assert.equal(parseProcessTable('invalid\n0 1 '+started).size,0);
});

test('listener observation coalesces requests, expires cache and bounds subprocesses', async () => {
  let time = 0, calls = 0;
  const observe = localServers({ uid: 501, roots:()=>[10], now: () => time, run: async (program, args, options) => {
    calls++;
    assert.ok(args.includes('501')); assert.equal(options.timeout, 2000); assert.equal(options.maxBuffer, 256 * 1024);
    if(program==='ps') { assert.deepEqual(args,['-U','501','-o','pid=,ppid=,lstart=']); return {stdout:table([[10,1],[11,10]])}; }
    assert.ok(program.endsWith('lsof')); return {stdout:'p11\ncnode\nn*:4318\n'};
  } });
  await Promise.all([observe(), observe()]); assert.equal(calls, 2);
  await observe(); assert.equal(calls, 2);
  time = 5001; await observe(); assert.equal(calls, 4);
  await observe({fresh:true});assert.equal(calls,6);
});

test('observation failures retire stale servers and do not expose diagnostics', async () => {
  let time = 0;
  const observe = localServers({ uid: 501, roots:()=>[10], now: () => time, run: async program => {
    if (!time) return { stdout: program==='ps'?table([[10,1],[11,10]]):'p11\ncnode\nn*:4318\n' };
    throw Object.assign(new Error('private command details'), { stderr: 'private data' });
  } });
  assert.equal((await observe()).servers.length, 1);
  time = 6000;
  const result = await observe(); assert.deepEqual(result.servers, []); assert.match(result.issue, /unavailable/); assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('only runtime-owned app servers are discovered, including custom binaries and scheduled workers', async () => {
  const observe=localServers({uid:501,roots:()=>[10,20],run:async program=>({stdout:program==='ps'?table([[1,0],[10,1],[11,10],[12,11],[20,1],[21,20],[30,1],[31,30]]):'p1\ncnode\nn*:4317\np10\nchot-cross-buns-runtime\nn*:52000\np11\ncagent\nn*:4318\np12\ncmy-app\nn*:3000\np21\ncpython\nn*:8000\np31\ncnode\nn*:4000\n'})});
  assert.deepEqual((await observe()).servers.map(server=>server.port),[3000,4318,8000]);
});

test('unknown ownership fails closed and newly started runtimes invalidate cached provenance', async () => {
  let roots=[],calls=0;
  const observe=localServers({uid:501,roots:()=>roots,run:async program=>{calls++;return {stdout:program==='ps'?table([[10,1],[11,10]]):'p11\ncnode\nn*:4318\n'};}});
  assert.deepEqual((await observe()).servers,[]);assert.equal(calls,1);
  roots=[10];assert.equal((await observe()).servers.length,1);assert.equal(calls,3);
});


test('real observed descendants remain attributable after their launcher exits', {skip:process.platform==='win32',timeout:15000}, async t => {
  const serverCode='const s=require("node:http").createServer((q,r)=>r.end("owned fixture"));s.listen(0,"127.0.0.1",()=>console.log(JSON.stringify({pid:process.pid,port:s.address().port})));';
  const launcher=spawn(process.execPath,['-e',`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(serverCode)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe']});
  let child;
  t.after(()=>{launcher.kill();if(child)try{process.kill(child.pid);}catch{}});
  const [bytes]=await once(launcher.stdout,'data');child=JSON.parse(bytes.toString());
  let roots=[launcher.pid];
  const observe=localServers({roots:()=>roots});
  const first=await observe();
  assert.ok(first.servers.some(server=>server.pid===child.pid&&server.port===child.port),first.issue);
  assert.ok(first.servers.every(server=>server.pid===child.pid));
  const exited=once(launcher,'exit');launcher.kill();await exited;roots=[];
  assert.ok((await observe({fresh:true})).servers.some(server=>server.pid===child.pid));
});
