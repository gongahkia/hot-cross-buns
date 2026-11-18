import type { MarkdownNode } from './markdown.ts';
import type { MarkdownPlanner, PlannerDetail, PlannerEntry, SourceRange } from './markdownPlanner.ts';
import { taskChildren } from './outline.ts';
import { finishMarkdownMeasurement, startMarkdownMeasurement } from './markdownMeasurements.ts';

type Owner = { section: 'days' | 'undated'; group: number; entry: number };
type Token = { range: SourceRange; node: number; kind: 'title' | 'checkbox'; owner: Owner };
type Change = { title?: string; completed?: boolean };
const plainTitle = /^[A-Za-z](?:[A-Za-z ]*[A-Za-z])?$/;

export function createPlannerIncrementalValidator() {
  const validated = new WeakMap<MarkdownPlanner, 'full' | 'incremental'>();
  const indexes = new WeakMap<MarkdownPlanner, Token[]>();

  /** internal parser certificate: copied/wire models must pass the full parser before reuse. */
  function sealParsedPlanner(model: MarkdownPlanner, kind: 'full' | 'incremental' = 'full'): MarkdownPlanner {
    const pending: object[] = [model];
    while (pending.length) {
      const value = pending.pop()!;
      if (Object.isFrozen(value)) continue;
      for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
      Object.freeze(value);
    }
    validated.set(model, kind);
    return model;
  }

  function tokensFor(model: MarkdownPlanner): Token[] {
    let tokens = indexes.get(model);
    if (tokens) return tokens;
    tokens = [];
    const visit = (node: PlannerDetail, owner: Owner, children: PlannerDetail[]) => {
      if (plainTitle.test(node.markdown)) tokens!.push({ range: node.titleRange, node: node.range.start, kind: 'title', owner });
      if (node.checkbox) tokens!.push({ range: node.checkbox, node: node.range.start, kind: 'checkbox', owner });
      for (const child of children) visit(child, owner, child.children ?? []);
    };
    for (const section of ['days', 'undated'] as const) model[section].forEach((group, groupIndex) => group.entries.forEach((entry, entryIndex) => visit(entry, { section, group: groupIndex, entry: entryIndex }, entry.details)));
    tokens.sort((left, right) => left.range.start - right.range.start);
    indexes.set(model, tokens);
    return tokens;
  }

  function tokenAt(tokens: Token[], offset: number): Token | undefined {
    let low = 0, high = tokens.length;
    while (low < high) { const middle = (low + high) >>> 1; if (tokens[middle].range.start <= offset) low = middle + 1; else high = middle; }
    const token = tokens[low - 1];
    return token && offset < token.range.end ? token : undefined;
  }

  function consistent(entry: PlannerEntry, format: number): boolean {
    const pending = [...entry.details];
    while (pending.length) {
      const node = pending.pop()!, children = node.children ?? [];
      if ((entry.date || format === 3) && node.kind !== 'note') {
        const tasks = taskChildren(children);
        if (tasks.length && node.completed !== tasks.every(child => child.completed)) return false;
      }
      pending.push(...children);
    }
    const tasks = format === 1 ? entry.details : taskChildren(entry.details);
    return !(entry.kind !== 'note' && tasks.length && entry.completed !== tasks.every(child => child.completed)
      || entry.completedOn && !entry.completed
      || entry.repeat?.kind === 'after' && entry.completed && !entry.completedOn);
  }

  /** reuse unchanged grammar only when every changed character belongs to a certified token. */
  function incrementallyValidatePlanner(model: MarkdownPlanner, source: string): MarkdownPlanner | null {
    if (!validated.has(model) || ![1, 2, 3].includes(model.format ?? 0) || model.issues.some(issue => issue.severity === 'error') || source.length !== model.source.length) return null;
    if (source === model.source) return model;
    const started = startMarkdownMeasurement(), before = model.source;
    let start = 0, end = source.length;
    while (before[start] === source[start]) start++;
    while (end > start && before[end - 1] === source[end - 1]) end--;
    const tokens = tokensFor(model), changes = new Map<number, Change>(), owners = new Set<Owner>();
    for (let offset = start; offset < end;) {
      if (before[offset] === source[offset]) { offset++; continue; }
      const token = tokenAt(tokens, offset);
      if (!token) return null;
      const text = source.slice(token.range.start, token.range.end), change = changes.get(token.node) ?? {};
      if (token.kind === 'title') {
        if (!plainTitle.test(text)) return null;
        change.title = text;
      } else {
        if (!/^[ xX]$/.test(text)) return null;
        change.completed = text !== ' ';
      }
      changes.set(token.node, change); owners.add(token.owner); offset = token.range.end;
    }
    const update = <T extends PlannerDetail>(node: T): T => {
      const change = changes.get(node.range.start), children = 'details' in node ? (node as unknown as PlannerEntry).details : node.children;
      const next = children?.map(update), changedChildren = next?.some((child, index) => child !== children![index]);
      return !change && !changedChildren ? node : { ...node,
        ...(change?.title === undefined ? {} : { markdown: change.title, text: change.title }),
        ...(change?.completed === undefined ? {} : { completed: change.completed }),
        ...(changedChildren ? 'details' in node ? { details: next } : { children: next } : {}),
      };
    };
    const next = { ...model, source };
    for (const section of ['days', 'undated'] as const) {
      const groups = new Map<number, Set<number>>();
      for (const owner of owners) if (owner.section === section) {
        if (!groups.has(owner.group)) groups.set(owner.group, new Set());
        groups.get(owner.group)!.add(owner.entry);
      }
      if (groups.size) next[section] = model[section].map((group, index) => {
        const entries = groups.get(index);
        return entries ? { ...group, entries: group.entries.map((entry, index) => entries.has(index) ? update(entry) : entry) } : group;
      });
    }
    // unchanged syntax preserves identities/references; completion still requires ancestor and date checks.
    for (const owner of owners) if (!consistent(next[owner.section][owner.group].entries[owner.entry], model.format!)) return null;
    const overlap = (range: SourceRange) => range.start < end && range.end > start;
    const render = (node: MarkdownNode): MarkdownNode => {
      if (!overlap(node.range)) return node;
      const change = changes.get(node.range.start);
      const title = tokenAt(tokens, node.range.start);
      const text = node.type === 'text' && title?.kind === 'title' && title.range.start === node.range.start && title.range.end === node.range.end ? changes.get(title.node)?.title : undefined;
      const children = node.children?.map(render), changedChildren = children?.some((child, index) => child !== node.children![index]);
      const checked = node.type === 'listItem' ? change?.completed : undefined;
      return text === undefined && checked === undefined && !changedChildren ? node : { ...node,
        ...(text === undefined ? {} : { value: text }), ...(checked === undefined ? {} : { checked }), ...(changedChildren ? { children } : {}),
      };
    };
    let blocks = model.markdown.blocks;
    for (const [key, node] of Object.entries(blocks)) {
      const updated = render(node);
      if (updated !== node) { if (blocks === model.markdown.blocks) blocks = Object.assign(Object.create(null), blocks); blocks[key] = updated; }
    }
    if (blocks !== model.markdown.blocks) next.markdown = { ...model.markdown, blocks };
    sealParsedPlanner(next, 'incremental'); indexes.set(next, tokens);
    finishMarkdownMeasurement('incrementalValidation', started, source.length);
    return next;
  }

  return { seal: sealParsedPlanner, validate: incrementallyValidatePlanner, kind: (model:MarkdownPlanner) => validated.get(model) };
}
