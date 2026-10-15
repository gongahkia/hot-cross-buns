import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDoctorAction, doctorTodoText } from '../src/todoDoctor.ts';
import { parseTodoText, serializeTodoText } from '../src/todoText.ts';

test('doctor proposes narrow marker repairs while retaining the original text', () => {
  const original = '2026-10-15\n\nWater plants\n\t@REPEAT: daily\n  - [ ] check soil\n';
  const report = doctorTodoText(original, '2026-10-15');
  assert.equal(original.includes('\t@REPEAT:'), true);
  assert.equal(report.candidate, '2026-10-15\n\nWater plants\n  @repeat: daily\n- [ ] check soil\n');
  assert.equal(report.ready, true);
  assert.equal(report.findings.length, 2);
  assert.deepEqual(parseTodoText(report.candidate, '2026-10-15').issues, []);
});

test('doctor requires an explicit choice for a missing divider', () => {
  const raw = '2026-10-14\nTask\n';
  const finding = doctorTodoText(raw, '2026-10-15').findings.find(finding => finding.code === 'divider');
  assert.ok(finding);
  const upcoming = applyDoctorAction(raw, finding, 'mark-upcoming');
  const done = applyDoctorAction(raw, finding, 'mark-done');
  assert.equal(parseTodoText(upcoming, '2026-10-15').document.days[0].items[0].completed, false);
  assert.equal(parseTodoText(done, '2026-10-15').document.days[0].items[0].completed, true);
  assert.equal(doctorTodoText(upcoming, '2026-10-15').ready, true);
  assert.equal(doctorTodoText(done, '2026-10-15').ready, true);
});

test('doctor does not reinterpret malformed metadata or erase invalid text', () => {
  const raw = '2026-10-15\n\nTask\n @repeat: every 0 days after completion\n25:00-26:00 Bad time\n';
  const report = doctorTodoText(raw, '2026-10-15');
  assert.equal(report.candidate, raw);
  assert.equal(report.ready, false);
  assert.match(report.findings.map(finding => finding.message).join(' '), /Metadata needs exactly two spaces/);
  assert.match(report.findings.map(finding => finding.message).join(' '), /Time blocks need valid/);
  const literal = { days: [{ date: '2026-10-15', items: [{ id: 'literal', text: '@repeat: daily', details: [], completed: false }] }] };
  assert.deepEqual(parseTodoText(serializeTodoText(literal), '2026-10-15').issues, []);
});

test('doctor can repair a completed legacy recurrence only with chosen values', () => {
  const raw = '2026-10-13\nWater plants\n  @repeat: every 3 days after completion\n\n';
  let report = doctorTodoText(raw, '2026-10-15');
  assert.deepEqual(report.findings.filter(finding => finding.level === 'review').map(finding => finding.code), ['completion-date', 'series-id']);
  const dated = applyDoctorAction(report.candidate, report.findings.find(finding => finding.code === 'completion-date'), 'set-completion-date', '2026-10-14');
  report = doctorTodoText(dated, '2026-10-15');
  const identified = applyDoctorAction(report.candidate, report.findings.find(finding => finding.code === 'series-id'), 'start-series');
  report = doctorTodoText(identified, '2026-10-15');
  assert.equal(report.ready, true);
  assert.equal(report.findings.length, 0);
  const item = parseTodoText(identified, '2026-10-15').document.days[0].items[0];
  assert.equal(item.completedOn, '2026-10-14');
  assert.equal(item.repeat.occurrence, 1);
  assert.match(item.repeat.series, /^water-plants-/);
});

test('empty headings need no doctor repair', () => {
  assert.deepEqual(doctorTodoText('2026-10-15\n', '2026-10-15').findings, []);
});

test('doctor reviews a UTF-8 BOM file without changing its content or missing its divider', () => {
  const raw = '\uFEFF2026-10-15\nCheck first line\n';
  const report = doctorTodoText(raw, '2026-10-15');
  assert.equal(report.candidate, raw);
  const divider = report.findings.find(finding => finding.code === 'divider');
  assert.equal(divider?.line, 1);
  assert.equal(doctorTodoText(applyDoctorAction(raw, divider, 'mark-upcoming'), '2026-10-15').ready, true);
});
