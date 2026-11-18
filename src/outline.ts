import type { TodoBody, TodoDetail, TodoItem } from './todoText.ts';

export function replaceMarkdownBody(body: TodoBody[] | undefined, markdown: string, block?: number): TodoBody[] | undefined {
  if (block === undefined) return markdown.trim() ? [{ markdown }] : undefined;
  if (!Number.isInteger(block) || block < 0 || !body?.[block]) throw new Error('This notes block changed. Keep your draft and review the latest notes.');
  const next = [...body];
  if (markdown.trim()) next[block] = { ...next[block], markdown };
  else next.splice(block, 1);
  return next.length ? next : undefined;
}

export const MAX_OUTLINE_DEPTH = 32;
type OutlineNode = { completed: boolean; kind?: 'note'; children?: OutlineNode[] };

export function taskChildren<T extends OutlineNode>(nodes: T[]): T[] {
  const result: T[] = [], pending = [...nodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind !== 'note') result.push(node);
    else if (node.children) pending.push(...[...node.children as T[]].reverse());
  }
  return result;
}

export function outlineNodes<T extends OutlineNode>(nodes: T[]): T[] {
  const result: T[] = [], pending = [...nodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    result.push(node);
    if (node.children) pending.push(...[...node.children as T[]].reverse());
  }
  return result;
}

export function refreshItemCompletion(item: TodoItem): void {
  for (const node of outlineNodes(item.details).reverse()) {
    const tasks = taskChildren(node.children ?? []);
    if (node.kind !== 'note' && tasks.length) node.completed = tasks.every(child => child.completed);
  }
  const tasks = taskChildren(item.details);
  if (item.kind === 'note') item.completed = false;
  else if (tasks.length) item.completed = tasks.every(child => child.completed);
}

export function setItemCompletion(item: TodoItem, completed: boolean): void {
  item.completed = completed;
  for (const node of outlineNodes(item.details)) if (node.kind !== 'note') node.completed = completed;
}

export function unfinishedTaskCount(item: TodoItem): number {
  return item.kind === 'note' ? taskChildren(item.details).filter(task => !task.completed).length : Number(!item.completed);
}

export function resetDetails(details: TodoDetail[]): TodoDetail[] {
  const next = structuredClone(details);
  for (const node of outlineNodes(next)) node.completed = false;
  return next;
}

export function detailAt(details: TodoDetail[], path: number[]): TodoDetail {
  let node: TodoDetail | undefined;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || !details[index]) throw new Error('This outline item is no longer available.');
    node = details[index]; details = node.children ?? [];
  }
  if (!node) throw new Error('Choose an outline item.');
  return node;
}

export function detailSiblings(item: TodoItem, path: number[]): TodoDetail[] {
  return path.length === 1 ? item.details : detailAt(item.details, path.slice(0, -1)).children ?? [];
}

export function moveOutlineDetail(item: TodoItem, path: number[], direction: 'up' | 'down' | 'in' | 'out'): void {
  const node = detailAt(item.details, path), siblings = detailSiblings(item, path), index = path.at(-1)!;
  if (direction === 'in') {
    if (!index) return;
    (siblings[index - 1].children ??= []).push(siblings.splice(index, 1)[0]);
  } else if (direction === 'out') {
    if (path.length < 2) return;
    const parentPath = path.slice(0, -1), parentSiblings = detailSiblings(item, parentPath);
    siblings.splice(index, 1); parentSiblings.splice(parentPath.at(-1)! + 1, 0, node);
  } else {
    const target = index + (direction === 'up' ? -1 : 1);
    if (target < 0 || target >= siblings.length) return;
    siblings.splice(index, 1); siblings.splice(target, 0, node);
  }
  refreshItemCompletion(item);
}

export function promoteOutlineDetail(item: TodoItem, items: TodoItem[], path: number[], id: string): void {
  const node = detailAt(item.details, path), siblings = detailSiblings(item, path);
  siblings.splice(path.at(-1)!, 1);
  const { children, kind: _kind, ...rest } = node;
  const promoted: TodoItem = { ...rest, id, details: children ?? [] };
  refreshItemCompletion(promoted); refreshItemCompletion(item);
  items.splice(items.indexOf(item) + 1, 0, promoted);
}

export function outlineText(item: TodoItem): string[] {
  return [item.text, ...(item.body ?? []).map(block => block.markdown), ...outlineNodes(item.details).flatMap(node => [node.text, ...(node.body ?? []).map(block => block.markdown)])];
}

export function outlineContent(item: TodoItem): string {
  const content = (node: TodoDetail): unknown => [node.text, node.kind, node.body, node.children?.map(content)];
  return JSON.stringify([item.text, item.body, item.details.map(content)]);
}
