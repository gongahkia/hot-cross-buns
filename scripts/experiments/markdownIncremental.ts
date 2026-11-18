import type {MarkdownNode} from '../../src/markdown.ts';
import type { MarkdownPlanner, SourcePatch } from '../../src/markdownPlanner.ts';

/** benchmark-only experiment; production source edits still use the full validator. */
export function incrementalTitleExperiment(model: MarkdownPlanner, patch: SourcePatch): MarkdownPlanner | null {
  if (model.issues.some(issue => issue.severity === 'error') || patch.text.length !== patch.expected.length || model.source.slice(patch.range.start, patch.range.end) !== patch.expected || !/^[A-Za-z](?:[A-Za-z ]*[A-Za-z])?$/.test(patch.text) || !/^[A-Za-z](?:[A-Za-z ]*[A-Za-z])?$/.test(patch.expected)) return null;
  for (const key of ['days', 'undated'] as const) for (let groupIndex = 0; groupIndex < model[key].length; groupIndex++) {
    const group = model[key][groupIndex], entryIndex = group.entries.findIndex(entry => entry.titleRange.start === patch.range.start && entry.titleRange.end === patch.range.end && entry.text === entry.markdown);
    if (entryIndex < 0) continue;
    const entries = [...group.entries], groups = [...model[key]];
    entries[entryIndex] = { ...entries[entryIndex], markdown: patch.text, text: patch.text };
    groups[groupIndex] = { ...group, entries };
    const update=(node:MarkdownNode):MarkdownNode=>{if(node.range.start>patch.range.start || node.range.end<patch.range.end)return node;if(node.type==='text' && node.range.start===patch.range.start && node.range.end===patch.range.end)return {...node,value:patch.text};return node.children?{...node,children:node.children.map(update)}:node;};
    const blocks=Object.assign(Object.create(null),Object.fromEntries(Object.entries(model.markdown.blocks).map(([key,node])=>[key,update(node)])));
    return { ...model, markdown:{...model.markdown,blocks}, source: model.source.slice(0, patch.range.start) + patch.text + model.source.slice(patch.range.end), [key]: groups };
  }
  return null;
}

export function sourceDelta(before: string, after: string): SourcePatch {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  if (oldEnd < before.length && /[\uDC00-\uDFFF]/.test(before[oldEnd])) { oldEnd++; newEnd++; }
  return { range: { start, end: oldEnd }, expected: before.slice(start, oldEnd), text: after.slice(start, newEnd) };
}
