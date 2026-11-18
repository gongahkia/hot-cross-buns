import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import * as current from '../src/journalDocument.ts';
import { benchmarkPlanner } from './markdown-benchmark-fixture.mjs';

const baselineArg=process.argv.find(arg=>arg.startsWith('--baseline='))?.slice(11);
const samples=Number(process.argv.find(arg=>arg.startsWith('--samples='))?.slice(10)??6);
if(!baselineArg || !Number.isInteger(samples) || samples<3 || samples>10 || process.argv.slice(2).some(arg=>!arg.startsWith('--baseline=')&&!arg.startsWith('--samples='))) throw new Error('Use --baseline=<commit> and optionally --samples=3 through --samples=10.');
const revision=ref=>execFileSync('git',['rev-parse','--verify','--end-of-options',`${ref}^{commit}`],{encoding:'utf8'}).trim();
const baselineCommit=revision(baselineArg),candidateCommit=revision('HEAD');
execFileSync(process.execPath,['scripts/patch-markdown-parser.mjs','--check']);
const output=path.resolve('.tmp/validation-comparison/latest.json');
await mkdir(path.dirname(output),{recursive:true});
const directory=await mkdtemp(path.join(path.dirname(output),'baseline-'));
try {
  execFileSync('tar',['-x','-C',directory],{input:execFileSync('git',['archive','--format=tar',baselineCommit,'src'],{maxBuffer:32*1024*1024})});
  const baseline=await import(pathToFileURL(path.join(directory,'src/journalDocument.ts')).href);
  const results={generatedAt:new Date().toISOString(),baselineCommit,candidateCommit,environment:{node:process.version,cpu:os.cpus()[0]?.model,platform:os.platform(),arch:os.arch()},entries:10000,samples,fullRead:{before:[],after:[]},completion:{before:[],after:[]},notes:['same-process interleaved Node runs using the same installed dependencies; input cloning is outside the completion timer','fullRead includes full parsing, projection and freezing; completion includes source materialization and validation, not browser transfer, paint or durable saving']};
  for(let round=0;round<samples;round++) {
    const outputs=[];
    for(const kind of round%2?['after','before']:['before','after']) {
      const api=kind==='before'?baseline:current,source=benchmarkPlanner(10000,'2026-11-18',round+800);
      let started=performance.now();const document=api.readJournal(source).document;results.fullRead[kind].push(performance.now()-started);
      const copy=structuredClone(document);copy.days.at(-1).items[0].completed=true;
      started=performance.now();const saved=api.materializeJournal(copy);results.completion[kind].push(performance.now()-started);
      assert.equal(saved.source,source.replace('- [ ] Visible task 0','- [x] Visible task 0'));
      outputs.push(api.journalModel(saved));
    }
    assert.deepEqual(outputs[0],outputs[1]);
  }
  await writeFile(output,JSON.stringify(results,null,2)+'\n');
  console.log(`Validation comparison: ${output}`);
} finally { await rm(directory,{recursive:true,force:true}); }
