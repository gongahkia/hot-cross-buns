import { extractDateFromText } from './nlp-date';

export interface QuickAddResult {
  title: string;
  dueDate?: string;
  recurrenceRule?: string;
  priority?: number;
  tagNames: string[];
}

export function parseQuickAdd(input: string): QuickAddResult {
  let text = input;
  const tagNames: string[] = [];
  let priority: number | undefined;
  // extract #tags
  text = text.replace(/#(\w[\w-]*)/g, (_match, tag) => {
    tagNames.push(tag);
    return '';
  });
  // extract !priority
  text = text.replace(/!(high|hi|h)\b/gi, () => { priority = 3; return ''; });
  text = text.replace(/!(med|medium|m)\b/gi, () => { priority = 2; return ''; });
  text = text.replace(/!(low|lo|l)\b/gi, () => { priority = 1; return ''; });
  // extract date/time/recurrence via existing NLP parser
  const result = extractDateFromText(text.trim());
  const title = result
    ? result.title.replace(/\s{2,}/g, ' ').trim()
    : text.trim().replace(/\s{2,}/g, ' ').trim();
  return {
    title: title || input.trim(),
    dueDate: result?.parsed.date,
    recurrenceRule: result?.parsed.recurrenceRule ?? undefined,
    priority,
    tagNames,
  };
}
