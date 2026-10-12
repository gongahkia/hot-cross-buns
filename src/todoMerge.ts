import { cloneDocument, emptyDocument, itemContent, itemValue, newId, type TodoDocument, type TodoItem } from './todoText.ts';

export type MergeChoice = 'local' | 'file' | 'both';
export type MergeRow = {
  key: string; date: string; order: number; localOrder: number; fileOrder: number; local: TodoItem | null; file: TodoItem | null;
  conflict: boolean; choice: MergeChoice; reorderConflict?: boolean;
};
export type MergeProposal = { rows: MergeRow[]; conflicts: MergeRow[] };

const same = (a: TodoItem | null, b: TodoItem | null) => a === b || (!!a && !!b && itemValue(a) === itemValue(b));
const itemsOn = (document: TodoDocument, date: string) => document.days.find(day => day.date === date)?.items ?? [];

/** Align text-file items to the last observed file without putting private IDs in TODO.txt. */
function align(base: TodoItem[], file: TodoItem[]) {
  const used = new Set<number>();
  const assigned = new Map<string, TodoItem | null>();
  const positions = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const old of base) {
    const matches = file.map((item, index) => ({ item, index })).filter(({ item, index }) => !used.has(index) && itemContent(item) === itemContent(old));
    const baseMatches = base.filter(item => itemContent(item) === itemContent(old));
    if (matches.length === 1 && baseMatches.length === 1) {
      used.add(matches[0].index);
      positions.set(old.id, matches[0].index);
      assigned.set(old.id, { ...matches[0].item, id: old.id });
    } else if (matches.length > 0 || baseMatches.length > 1) ambiguous.add(old.id);
  }
  const unmatched = base.filter(item => !assigned.has(item.id));
  if (unmatched.length !== file.length - used.size) unmatched.forEach(item => ambiguous.add(item.id));
  for (let index = 0; index < base.length; index++) {
    const old = base[index];
    if (assigned.has(old.id)) continue;
    const candidate = !used.has(index) && index < file.length ? index : file.findIndex((_, position) => !used.has(position));
    if (candidate >= 0) {
      used.add(candidate);
      positions.set(old.id, candidate);
      assigned.set(old.id, { ...file[candidate], id: old.id });
    } else assigned.set(old.id, null);
  }
  return { assigned, positions, ambiguous, additions: file.filter((_, index) => !used.has(index)) };
}

export function proposeMerge(local: TodoDocument, file: TodoDocument, baseline: TodoDocument | null): MergeProposal {
  const rows: MergeRow[] = [];
  const dates = new Set([...local.days, ...file.days, ...(baseline?.days ?? [])].map(day => day.date));
  for (const date of [...dates].sort()) {
    const localItems = itemsOn(local, date);
    const fileItems = itemsOn(file, date);
    if (!baseline) {
      const length = Math.max(localItems.length, fileItems.length);
      for (let index = 0; index < length; index++) {
        const left = localItems[index] ?? null;
        const right = fileItems[index] ?? null;
        const conflict = !!localItems.length && !same(left, right);
        rows.push({ key: `${date}:${index}`, date, order: index, localOrder: index, fileOrder: index, local: left, file: right, conflict, choice: left ? 'local' : 'file' });
      }
      continue;
    }
    const baseItems = itemsOn(baseline, date);
    const { assigned, positions, ambiguous, additions } = align(baseItems, fileItems);
    const byId = new Map(localItems.map(item => [item.id, item]));
    for (let index = 0; index < baseItems.length; index++) {
      const old = baseItems[index];
      const left = byId.get(old.id) ?? null;
      const right = assigned.get(old.id) ?? null;
      const localChanged = !same(left, old);
      const fileChanged = !same(right, old);
      const conflict = (localChanged && fileChanged && !same(left, right)) || (ambiguous.has(old.id) && (localChanged || fileChanged));
      const choice: MergeChoice = conflict ? 'local' : fileChanged ? 'file' : 'local';
      const fileIndex = positions.get(old.id) ?? -1;
      rows.push({ key: `${date}:base:${old.id}`, date, order: fileIndex >= 0 ? fileIndex : index, localOrder: localItems.findIndex(item => item.id === old.id), fileOrder: fileIndex, local: left, file: right, conflict, choice });
    }
    const localAdds = localItems.filter(item => !baseItems.some(old => old.id === item.id));
    const usedLocalAdds = new Set<string>();
    for (const item of additions) {
      const match = localAdds.find(left => !usedLocalAdds.has(left.id) && same(left, item));
      if (match) usedLocalAdds.add(match.id);
      rows.push({ key: `${date}:file:${item.id}`, date, order: fileItems.indexOf(item), localOrder: match ? localItems.indexOf(match) : -1, fileOrder: fileItems.indexOf(item), local: match ?? null, file: item, conflict: false, choice: 'file' });
    }
    for (const item of localAdds) {
      if (usedLocalAdds.has(item.id)) continue;
      rows.push({ key: `${date}:local:${item.id}`, date, order: localItems.indexOf(item) + .25, localOrder: localItems.indexOf(item), fileOrder: -1, local: item, file: null, conflict: false, choice: 'local' });
    }
    const dayRows = rows.filter(row => row.date === date);
    const common = new Set(baseItems.filter(old => byId.has(old.id) && assigned.get(old.id)).map(item => item.id));
    const baseOrder = baseItems.filter(item => common.has(item.id)).map(item => item.id).join('\0');
    const localOrder = localItems.filter(item => common.has(item.id)).map(item => item.id).join('\0');
    const fileOrder = dayRows.filter(row => row.file && row.key.includes(':base:') && common.has(row.file.id)).sort((a,b) => a.fileOrder - b.fileOrder).map(row => row.file!.id).join('\0');
    const localReordered = localOrder !== baseOrder;
    const fileReordered = fileOrder !== baseOrder;
    if (localReordered && !fileReordered) {
      dayRows.forEach(row => { row.order = row.localOrder >= 0 ? row.localOrder : row.fileOrder + .25; });
    } else if (localReordered && fileReordered && localOrder !== fileOrder) {
      dayRows.filter(row => row.file && row.local && common.has(row.file.id)).forEach(row => {
        row.conflict = true;
        row.reorderConflict = true;
        row.choice = 'local';
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.key.localeCompare(b.key));
  return { rows, conflicts: rows.filter(row => row.conflict) };
}

export function resolveMerge(proposal: MergeProposal, choices: Record<string, MergeChoice>) {
  const document = emptyDocument();
  const ordered = [...proposal.rows].sort((a,b) => {
    const aChoice = choices[a.key] ?? a.choice;
    const bChoice = choices[b.key] ?? b.choice;
    const aOrder = a.reorderConflict ? (aChoice === 'file' ? a.fileOrder : a.localOrder) : a.order;
    const bOrder = b.reorderConflict ? (bChoice === 'file' ? b.fileOrder : b.localOrder) : b.order;
    return a.date.localeCompare(b.date) || aOrder - bOrder || a.key.localeCompare(b.key);
  });
  for (const row of ordered) {
    const choice = choices[row.key] ?? row.choice;
    const selected = choice === 'both' ? [row.local, row.file] : [choice === 'local' ? row.local : row.file];
    const day = document.days.find(candidate => candidate.date === row.date) ?? (() => {
      const created = { date: row.date, items: [] as TodoItem[] };
      document.days.push(created);
      return created;
    })();
    for (const item of selected) {
      if (!item) continue;
      day.items.push({ ...item, id: day.items.some(existing => existing.id === item.id) ? newId() : item.id, details: [...item.details] });
    }
  }
  document.days = document.days.filter(day => day.items.length);
  return cloneDocument(document);
}

export function fileBaseline(proposal: MergeProposal) {
  const document = emptyDocument();
  for (const row of [...proposal.rows].sort((a,b) => a.date.localeCompare(b.date) || a.fileOrder - b.fileOrder)) {
    if (!row.file) continue;
    const day = document.days.find(candidate => candidate.date === row.date) ?? (() => {
      const created = { date: row.date, items: [] as TodoItem[] };
      document.days.push(created);
      return created;
    })();
    day.items.push({ ...row.file, id: row.local?.id ?? row.file.id, details: [...row.file.details] });
  }
  return document;
}
