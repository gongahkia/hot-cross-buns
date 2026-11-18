import { journalFromPlanner, journalModel } from './journalDocument.ts';
import { outlineNodes, taskChildren } from './outline.ts';
import { parseMarkdownPlanner, plannerEntries, plannerWritable, type PlannerDetail } from './markdownPlanner.ts';
import type { TodoDocument } from './todoText.ts';

/** an explicit source-format upgrade; never invoked by reading or syncing a document. */
export function upgradeOutlineJournal(document: TodoDocument, format: 2 | 3 = 2): { document: TodoDocument; checkboxChanges: number } {
  const before = journalModel(document);
  if (!plannerWritable(before)) throw new Error('Correct the Markdown source before enabling deeper outlines.');
  if ((before.format ?? 1) >= format) return { document, checkboxChanges: 0 };
  const match = /(?:^|\r\n|\r|\n)hcb-format: [12](?=[ \t]*(?:\r\n|\r|\n|$))/.exec(before.source);
  if (!match) throw new Error('The source format could not be located. Edit the Markdown source explicitly.');
  const offset = match.index + match[0].length - 1;
  let source = before.source.slice(0, offset) + format + before.source.slice(offset + 1);
  const model = parseMarkdownPlanner(source);
  const errors = model.issues.filter(issue => issue.severity === 'error' && issue.code !== 'completion-state');
  if (errors.length) throw new Error('Correct these outline issues in Markdown source first: ' + errors.map(issue => issue.message).join(' '));
  const patches: Array<{ offset: number; completed: boolean }> = [];
  const values = new Map<PlannerDetail, boolean>();
  for (const entry of plannerEntries(model)) {
    if (!entry.date) continue;
    for (const node of outlineNodes(entry.details).reverse()) {
      const tasks = taskChildren(node.children ?? []);
      const completed = node.kind !== 'note' && tasks.length ? tasks.every(child => values.get(child) ?? child.completed) : node.completed;
      values.set(node, completed);
      if (node.checkbox && completed !== node.completed) patches.push({ offset: node.checkbox.start, completed });
    }
    const tasks = taskChildren(entry.details);
    const completed = tasks.length ? tasks.every(child => values.get(child) ?? child.completed) : entry.completed;
    if (entry.checkbox && completed !== entry.completed) patches.push({ offset: entry.checkbox.start, completed });
  }
  for (const patch of patches.sort((a, b) => b.offset - a.offset)) source = source.slice(0, patch.offset) + (patch.completed ? 'x' : ' ') + source.slice(patch.offset + 1);
  const next = parseMarkdownPlanner(source);
  if (!plannerWritable(next)) throw new Error('This outline upgrade needs manual source review: ' + next.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join(' '));
  if (next.documentId !== before.documentId) throw new Error('An outline upgrade cannot change document identity.');
  return { document: journalFromPlanner(next).document, checkboxChanges: patches.length };
}

export const upgradeWritingJournal = (document: TodoDocument) => upgradeOutlineJournal(document, 3);
