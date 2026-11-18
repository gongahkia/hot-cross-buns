import { cachedJournal, journalFromPlanner, journalModel, materializeJournal, readJournal } from './journalDocument.ts';
import { upgradeOutlineJournal, upgradeWritingJournal } from './journalOutline.ts';
import { incrementalPlannerChanges, plannerValidationKind, plannerWritable, type MarkdownPlanner } from './markdownPlanner.ts';
import { boundedJournalPatches, type JournalDelta } from './journalTransport.ts';
import type { TodoDocument } from './todoText.ts';
import { editMarkdownPassage } from './markdownPassage.ts';
import type { SourceRange } from './markdownPlanner.ts';
import type { MarkdownLinkPreparation } from './markdownNavigation.ts';
import { runWritingOperation, type WritingOperation } from './journalWriting.ts';

export type JournalWork = { kind: 'parse'; source: string } | { kind: 'materialize' | 'upgrade' | 'upgrade-writing'; document: TodoDocument } | { kind: 'passage'; source: string; range: SourceRange; markdown: string; links: MarkdownLinkPreparation[] } | { kind: 'writing'; source: string; operation: WritingOperation };
export type JournalWorkRequest = JournalWork & { id: number; profile?: boolean; baselineId?: number; fullModel?: boolean };
export type JournalWorkResult = ({ id: number; ok: true; model: MarkdownPlanner; checkboxChanges?: number } | { id: number; ok: false; error: string }) & JournalWorkMeasurements;

type JournalWorkMeasurements = { workerMs?: number; validation?: 'full' | 'incremental'; responseCharacters?: number };
export type JournalWireResult = (JournalWorkResult | { id: number; ok: true; modelId: number; delta: JournalDelta }) & JournalWorkMeasurements & { modelId?: number };
export const journalWorkSource = (work: JournalWork) => 'source' in work ? work.source : work.document.source;

/** bounded worker-session baselines; missing or incompatible history always sends a full model. */
export function createJournalWorkerHost() {
  const baselines = new Map<number, MarkdownPlanner>();
  return (request: JournalWorkRequest): JournalWireResult => {
    const started = request.profile ? performance.now() : undefined;
    const base = request.fullModel ? undefined : baselines.get(request.baselineId!);
    const matched = base && base.source === journalWorkSource(request) ? base : undefined;
    if (matched && cachedJournal(matched.source)?.model !== matched) journalFromPlanner(matched);
    const result = runJournalWork(request);
    let wire: JournalWireResult = result;
    if (result.ok) {
      const model = result.model;
      if (plannerWritable(model)) {
        baselines.set(request.id, model);
        if (baselines.size > 4) baselines.delete(baselines.keys().next().value!);
      }
      const patches = matched && (model === matched ? [] : incrementalPlannerChanges(model, matched));
      wire = patches && boundedJournalPatches(patches)
        ? { id: request.id, ok: true, modelId: request.id, delta: { baselineId: request.baselineId!, patches } }
        : { ...result, modelId: request.id };
    }
    if (started !== undefined) {
      wire = { ...wire, workerMs: performance.now() - started, ...(result.ok ? { validation: plannerValidationKind(result.model) } : {}) };
      wire.responseCharacters = JSON.stringify(wire).length;
    }
    return wire;
  };
}

export function runJournalWork(request: JournalWorkRequest): JournalWorkResult {
  try {
    if (request.kind === 'parse') return { id: request.id, ok: true, model: readJournal(request.source).model };
    if (request.kind === 'writing') return { id: request.id, ok: true, model: runWritingOperation(request.source, request.operation) };
    if (request.kind === 'passage') return { id: request.id, ok: true, model: editMarkdownPassage(request.source, request.range, request.markdown, request.links) };
    if (request.kind === 'upgrade' || request.kind === 'upgrade-writing') {
      const result = request.kind === 'upgrade-writing' ? upgradeWritingJournal(request.document) : upgradeOutlineJournal(request.document);
      return { id: request.id, ok: true, model: journalModel(result.document), checkboxChanges: result.checkboxChanges };
    }
    return { id: request.id, ok: true, model: journalModel(materializeJournal(request.document)) };
  } catch (error) { return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
