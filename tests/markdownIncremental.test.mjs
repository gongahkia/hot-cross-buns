import assert from 'node:assert/strict';
import test from 'node:test';
import { incrementalTitleExperiment, sourceDelta } from '../scripts/experiments/markdownIncremental.ts';
import { parseMarkdownPlanner } from '../src/markdownPlanner.ts';
import { benchmarkPlanner } from '../scripts/markdown-benchmark-fixture.mjs';

test('the narrow incremental experiment matches the complete model across generated title edits', () => {
  for (const version of [1, 2]) for (const ending of ['\n', '\r\n', '\r']) {
    let source = '\uFEFF' + benchmarkPlanner(24, '2026-11-18').replace('hcb-format: 2', `hcb-format: ${version}`).replaceAll('\n', ending);
    for (let index = 0; index < 20; index++) {
      const before = parseMarkdownPlanner(source), entry = before.days[0].entries[index % 4];
      const text = index % 2 ? 'Historical item' : 'Historical task';
      const patch = { range: entry.titleRange, expected: entry.markdown, text };
      const incremental = incrementalTitleExperiment(before, patch);
      assert.ok(incremental);
      assert.deepEqual(incremental, parseMarkdownPlanner(incremental.source));
      assert.equal(before.source, source);
      source = incremental.source;
    }
  }
});

test('syntax, time prefixes, Unicode, size changes and stale ranges require full parsing', () => {
  const model = parseMarkdownPlanner(benchmarkPlanner(24, '2026-11-18')), entry = model.days[0].entries[0];
  for (const text of ['**changed**', '09:00-10:00 Meeting', '日本語', 'Changed', 'Historical task  ']) assert.equal(incrementalTitleExperiment(model, { range: entry.titleRange, expected: entry.markdown, text }), null);
  assert.equal(incrementalTitleExperiment(model, { range: entry.titleRange, expected: 'Different value', text: 'Historical task' }), null);
});

test('revision-patch extraction preserves Unicode boundaries and reproduces complete source', () => {
  for (const [before, after] of [['a👩🏽‍💻b', 'a🚀b'], ['a\r\nb', 'a\nb'], ['$$x_i$$', '$$y_j$$'], ['prefix', 'prefix more'], ['unchanged', 'unchanged']]) {
    const patch = sourceDelta(before, after);
    assert.equal(before.slice(0, patch.range.start) + patch.text + before.slice(patch.range.end), after);
    assert.equal(before.slice(patch.range.start, patch.range.end), patch.expected);
    assert.ok(!/^[\uDC00-\uDFFF]/.test(patch.text));
    assert.ok(!/[\uD800-\uDBFF]$/.test(patch.text));
  }
});
