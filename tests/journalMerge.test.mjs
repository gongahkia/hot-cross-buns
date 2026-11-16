import assert from 'node:assert/strict';
import test from 'node:test';
import { createJournal, journalFromModel, materializeJournal, parseJournal, withScratchpad } from '../src/journalDocument.ts';
import { fileBaseline, mergeJournalSources, proposeMerge, resolveMerge } from '../src/journalMerge.ts';

const entry = (id, text) => ({ id, text, completed: false, details: [] });
const baseline = () => journalFromModel({ days: [{ date: '2026-11-16', items: [entry('a', 'Walk dog'), entry('b', 'Read notes')] }] }, 'Meeting capture', 'shared');
const edit = (doc, fn) => { const next = structuredClone(doc); fn(next); return materializeJournal(next); };

test('source merge preserves independent task and scratchpad changes including opaque Markdown', () => {
  const plain = baseline();
  const base = parseJournal(plain.source.replace('## Undated', '## Research\n\n```mermaid\ngraph TD; A-->B\n```\n\n## Undated')).document;
  const local = edit(base, doc => { doc.days[0].items[0].text = 'Walk dog longer'; });
  const remote = withScratchpad(base, 'Remote meeting capture');
  const merged = mergeJournalSources(base, local, remote);
  assert.ok(merged);
  assert.equal(merged.days[0].items[0].text, 'Walk dog longer');
  assert.equal(merged.scratchpad, 'Remote meeting capture');
  assert.match(merged.source, /```mermaid\ngraph TD; A-->B\n```/);
});

test('two complete app-authored additions at one insertion point survive and converge deterministically', () => {
  const base = baseline();
  const local = edit(base, doc => doc.days[0].items.push(entry('local', 'Local addition')));
  const remote = edit(base, doc => doc.days[0].items.push(entry('remote', 'Remote addition')));
  const merged = mergeJournalSources(base, local, remote);
  assert.ok(merged);
  assert.deepEqual(new Set(merged.days[0].items.map(item => item.id)), new Set(['a', 'b', 'local', 'remote']));
  assert.equal(merged.source, mergeJournalSources(base, remote, local).source);
});

test('concurrent writes to the same title or scratchpad require explicit review', () => {
  const base = baseline();
  const local = edit(base, doc => { doc.days[0].items[0].text = 'Feed dog'; });
  const remote = edit(base, doc => { doc.days[0].items[0].text = 'Walk cat'; });
  assert.equal(mergeJournalSources(base, local, remote), null, 'different character ranges still belong to one title field');
  assert.equal(mergeJournalSources(base, withScratchpad(base, 'Local capture'), withScratchpad(base, 'Remote capture')), null);
});

test('completion and recurrence metadata form one atomic progress value', () => {
  const base = baseline();
  const local = edit(base, doc => { doc.days[0].items[0].completed = true; });
  const remote = edit(base, doc => { doc.days[0].items[0].repeat = { kind: 'daily', series: 'daily' }; });
  assert.equal(mergeJournalSources(base, local, remote), null);
});

test('manual review retains complete source versions and validates an explicit merged result', () => {
  const base = baseline();
  const local = withScratchpad(base, 'Local capture');
  const remote = withScratchpad(base, 'Remote capture');
  const proposal = proposeMerge(local, remote, base);
  assert.equal(proposal.conflicts.length, 1);
  assert.equal(resolveMerge(proposal, { source: 'local' }).source, local.source);
  assert.equal(resolveMerge(proposal, { source: 'file' }).source, remote.source);
  const manual = withScratchpad(base, 'Local capture\nRemote capture').source;
  assert.equal(resolveMerge(proposal, { source: 'both' }, manual).scratchpad, 'Local capture\nRemote capture');
  assert.throws(() => resolveMerge(proposal, { source: 'both' }, 'invalid document'), /planner|frontmatter|sections/);
  assert.equal(fileBaseline(proposal).source, remote.source);
});

test('different document identities and ambiguous structural edits do not auto-merge', () => {
  const base = baseline();
  assert.equal(mergeJournalSources(base, base, createJournal('other')), null);
  const local = edit(base, doc => { doc.days[0].items.reverse(); });
  const remote = edit(base, doc => { doc.days[0].items[0].text = 'Changed'; });
  assert.equal(mergeJournalSources(base, local, remote), null);
});
