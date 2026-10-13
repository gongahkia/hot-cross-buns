import { cloneDocument, emptyDocument, itemContent, itemValue, newId, type TodoDocument, type TodoItem } from './todoText.ts';

export type MergeChoice = 'local' | 'file' | 'both';
export type MergeRow = {
  key: string; date: string; order: number; localOrder: number; fileOrder: number; local: TodoItem | null; file: TodoItem | null;
  conflict: boolean; choice: MergeChoice; reorderConflict?: boolean;
};
export type MergeProposal = { rows: MergeRow[]; conflicts: MergeRow[] };

const same = (a: TodoItem | null, b: TodoItem | null) => a === b || (!!a && !!b && itemValue(a) === itemValue(b));
/** Align text-file items to the last observed file without putting private IDs in TODO.txt. */
function align(base: TodoItem[], file: TodoItem[]) {
  const used = new Set<number>();
  const assigned = new Map<string, TodoItem | null>();
  const positions = new Map<string, number>();
  const ambiguous = new Set<string>();
  const fileByContent = new Map<string, number[]>();
  const baseCounts = new Map<string, number>();
  file.forEach((item, index) => {
    const content = itemContent(item);
    const matches = fileByContent.get(content) ?? [];
    matches.push(index);
    fileByContent.set(content, matches);
  });
  base.forEach(item => {
    const content = itemContent(item);
    baseCounts.set(content, (baseCounts.get(content) ?? 0) + 1);
  });
  for (const old of base) {
    const content = itemContent(old);
    const matches = fileByContent.get(content) ?? [];
    if (matches.length === 1 && baseCounts.get(content) === 1 && !used.has(matches[0])) {
      const index = matches[0];
      used.add(index);
      positions.set(old.id, index);
      assigned.set(old.id, { ...file[index], id: old.id });
    } else if (matches.some(index => !used.has(index)) || (baseCounts.get(content) ?? 0) > 1) ambiguous.add(old.id);
  }
  const unmatched = base.filter(item => !assigned.has(item.id));
  if (unmatched.length !== file.length - used.size) unmatched.forEach(item => ambiguous.add(item.id));
  let nextUnused = 0;
  for (let index = 0; index < base.length; index++) {
    const old = base[index];
    if (assigned.has(old.id)) continue;
    while (used.has(nextUnused)) nextUnused++;
    const candidate = !used.has(index) && index < file.length ? index : nextUnused < file.length ? nextUnused : -1;
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
  const localByDate = new Map(local.days.map(day => [day.date, day.items] as const));
  const fileByDate = new Map(file.days.map(day => [day.date, day.items] as const));
  const baseByDate = new Map(baseline?.days.map(day => [day.date, day.items] as const) ?? []);
  const dates = new Set([...local.days, ...file.days, ...(baseline?.days ?? [])].map(day => day.date));
  for (const date of [...dates].sort()) {
    const localItems = localByDate.get(date) ?? [];
    const fileItems = fileByDate.get(date) ?? [];
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
    const dayStart = rows.length;
    const baseItems = baseByDate.get(date) ?? [];
    const { assigned, positions, ambiguous, additions } = align(baseItems, fileItems);
    const byId = new Map(localItems.map(item => [item.id, item]));
    const localIndex = new Map(localItems.map((item, index) => [item.id, index]));
    const fileIndex = new Map(fileItems.map((item, index) => [item, index]));
    for (let index = 0; index < baseItems.length; index++) {
      const old = baseItems[index];
      const left = byId.get(old.id) ?? null;
      const right = assigned.get(old.id) ?? null;
      const localChanged = !same(left, old);
      const fileChanged = !same(right, old);
      const conflict = (localChanged && fileChanged && !same(left, right)) || (ambiguous.has(old.id) && (localChanged || fileChanged));
      const choice: MergeChoice = conflict ? 'local' : fileChanged ? 'file' : 'local';
      const fileIndex = positions.get(old.id) ?? -1;
      rows.push({ key: `${date}:base:${old.id}`, date, order: fileIndex >= 0 ? fileIndex : index, localOrder: localIndex.get(old.id) ?? -1, fileOrder: fileIndex, local: left, file: right, conflict, choice });
    }
    const baseIds = new Set(baseItems.map(item => item.id));
    const localAdds = localItems.filter(item => !baseIds.has(item.id));
    const localAddsByValue = new Map<string, TodoItem[]>();
    localAdds.forEach(item => {
      const value = itemValue(item);
      const matches = localAddsByValue.get(value) ?? [];
      matches.push(item);
      localAddsByValue.set(value, matches);
    });
    const usedLocalAdds = new Set<string>();
    for (const item of additions) {
      const match = localAddsByValue.get(itemValue(item))?.shift();
      if (match) usedLocalAdds.add(match.id);
      const index = fileIndex.get(item) ?? -1;
      rows.push({ key: `${date}:file:${item.id}`, date, order: index, localOrder: match ? localIndex.get(match.id) ?? -1 : -1, fileOrder: index, local: match ?? null, file: item, conflict: false, choice: 'file' });
    }
    for (const item of localAdds) {
      if (usedLocalAdds.has(item.id)) continue;
      const index = localIndex.get(item.id) ?? -1;
      rows.push({ key: `${date}:local:${item.id}`, date, order: index + .25, localOrder: index, fileOrder: -1, local: item, file: null, conflict: false, choice: 'local' });
    }
    const dayRows = rows.slice(dayStart);
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
  const days = new Map<string, { date: string; items: TodoItem[] }>();
  const idsByDate = new Map<string, Set<string>>();
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
    let day = days.get(row.date);
    if (!day) {
      day = { date: row.date, items: [] };
      days.set(row.date, day);
      idsByDate.set(row.date, new Set());
      document.days.push(day);
    }
    const ids = idsByDate.get(row.date)!;
    for (const item of selected) {
      if (!item) continue;
      const id = ids.has(item.id) ? newId() : item.id;
      ids.add(id);
      day.items.push({ ...item, id, details: item.details.map(detail => ({ ...detail })) });
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
    day.items.push({ ...row.file, id: row.local?.id ?? row.file.id, details: row.file.details.map(detail => ({ ...detail })) });
  }
  return document;
}
