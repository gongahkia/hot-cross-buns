import { journalModel, materializeJournal } from './journalDocument.ts';
import { upgradeOutlineJournal } from './journalOutline.ts';
import { parseMarkdownPlanner, type MarkdownPlanner } from './markdownPlanner.ts';
import type { TodoDocument } from './todoText.ts';
import { editMarkdownPassage } from './markdownPassage.ts';
import type { SourceRange } from './markdownPlanner.ts';
import type { MarkdownLinkPreparation } from './markdownNavigation.ts';

export type JournalWork = { kind: 'parse'; source: string } | { kind: 'materialize' | 'upgrade'; document: TodoDocument } | { kind: 'passage'; source: string; range: SourceRange; markdown: string; links: MarkdownLinkPreparation[] };
export type JournalWorkRequest = JournalWork & { id: number; profile?: boolean };
export type JournalWorkResult = ({ id: number; ok: true; model: MarkdownPlanner; checkboxChanges?: number } | { id: number; ok: false; error: string }) & { workerMs?: number };

export function runJournalWork(request: JournalWorkRequest): JournalWorkResult {
  try {
    if (request.kind === 'parse') return { id: request.id, ok: true, model: parseMarkdownPlanner(request.source) };
    if (request.kind === 'passage') return { id: request.id, ok: true, model: editMarkdownPassage(request.source, request.range, request.markdown, request.links) };
    if (request.kind === 'upgrade') {
      const result = upgradeOutlineJournal(request.document);
      return { id: request.id, ok: true, model: journalModel(result.document), checkboxChanges: result.checkboxChanges };
    }
    return { id: request.id, ok: true, model: journalModel(materializeJournal(request.document)) };
  } catch (error) { return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
