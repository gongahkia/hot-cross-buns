import { cachedJournal, isCanonicalJournal, journalFromPlanner, journalModel, materializeJournal, readJournal } from './journalDocument.ts';
import { upgradeOutlineJournal, upgradeWritingJournal } from './journalOutline.ts';
import { assertImportText } from './importLimits.ts';
import type { JournalWork, JournalWorkRequest, JournalWorkResult } from './journalWorker.ts';
import type { TodoDocument } from './todoText.ts';
import { editMarkdownPassage } from './markdownPassage.ts';
import type { SourceRange } from './markdownPlanner.ts';
import type { MarkdownLinkPreparation } from './markdownNavigation.ts';
import { finishMarkdownMeasurement, recordMarkdownDuration, startMarkdownMeasurement } from './markdownMeasurements.ts';
import { runWritingOperation, type WritingOperation } from './journalWriting.ts';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
type Pending = { operation: JournalWork['kind']; started?: number; resolve: (value: Extract<JournalWorkResult, { ok: true }>) => void; reject: (error: Error) => void; cleanup: () => void };
export class JournalWorkerUnavailable extends Error {}

/** one worker and at most eight outstanding requests; results never commit journal state. */
export class JournalBackground {
  private worker: WorkerPort | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private createWorker: () => WorkerPort;
  private timeoutMs: number;
  constructor(createWorker: () => WorkerPort, timeoutMs = 30_000) { this.createWorker = createWorker; this.timeoutMs = timeoutMs; }

  request(work: JournalWork, signal?: AbortSignal): Promise<Extract<JournalWorkResult, { ok: true }>> {
    if (signal?.aborted) return Promise.reject(new DOMException('Journal validation was cancelled.', 'AbortError'));
    if (this.pending.size >= 8) return Promise.reject(new Error('Journal validation is busy. Wait for the current edits, then retry.'));
    if (!this.worker) {
      try { this.worker = this.createWorker(); }
      catch { return Promise.reject(new JournalWorkerUnavailable('Background journal validation could not start.')); }
      this.worker.onmessage = (event: MessageEvent<JournalWorkResult>) => {
        const result = event.data, pending = this.pending.get(result.id);
        if (!pending) return;
        finishMarkdownMeasurement(`workerRoundTrip:${pending.operation}`, pending.started);
        if (pending.started !== undefined && result.workerMs !== undefined) {
          recordMarkdownDuration(`workerWork:${pending.operation}`, result.workerMs);
          if (result.validation) recordMarkdownDuration(`workerValidation:${pending.operation}:${result.validation}`, result.workerMs);
        }
        this.pending.delete(result.id); pending.cleanup();
        if (result.ok) pending.resolve(result); else pending.reject(new Error(result.error));
      };
      this.worker.onerror = event => { event.preventDefault(); this.dispose(`Background journal validation failed${event.message ? ': ' + event.message : ''}. Retry the edit; the submitted draft has not been applied.`, true); };
      this.worker.onmessageerror = () => this.dispose('Background journal validation returned unreadable data. Retry the edit.', true);
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => { const pending = this.pending.get(id); if (pending) { this.pending.delete(id); pending.cleanup(); reject(new DOMException('Journal validation was cancelled.', 'AbortError')); } };
      const timeout = setTimeout(() => this.dispose('Journal validation exceeded its time budget. Keep or download your draft, then retry.'), this.timeoutMs);
      const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); };
      const started = startMarkdownMeasurement();
      this.pending.set(id, { operation: work.kind, started, resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try { const posted = startMarkdownMeasurement(); this.worker!.postMessage({ ...work, id, ...(started === undefined ? {} : { profile: true }) } satisfies JournalWorkRequest); finishMarkdownMeasurement(`postMessage:${work.kind}`, posted); }
      catch { this.pending.delete(id); cleanup(); reject(new Error('Journal validation could not be submitted. Keep your draft and retry.')); }
    });
  }

  dispose(message = 'Journal validation was stopped. Keep your draft and retry.', allowFallback = false): void {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(allowFallback ? new JournalWorkerUnavailable(message) : new Error(message)); }
    this.pending.clear();
  }
}

let background: JournalBackground | undefined;
const client = () => background ??= new JournalBackground(() => new Worker(new URL('./journalWorkerEntry.ts', import.meta.url), { type: 'module', name: 'planner-validation' }));
const adopt = (model: Parameters<typeof journalFromPlanner>[0]) => { const started = startMarkdownMeasurement(); const result = journalFromPlanner(model); finishMarkdownMeasurement('modelAdoption', started, model.source.length); return result; };

export async function readJournalAsync(source: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Journal validation was cancelled.', 'AbortError');
  const cached = cachedJournal(source);
  if (cached) return cached;
  assertImportText(source);
  if (typeof Worker === 'undefined') return readJournal(source);
  let result;
  try { result = await client().request({ kind: 'parse', source }, signal); }
  catch (error) { if (signal?.aborted) throw new DOMException('Journal validation was cancelled.', 'AbortError'); if (error instanceof JournalWorkerUnavailable) return readJournal(source); throw error; }
  if (signal?.aborted) throw new DOMException('Journal validation was cancelled.', 'AbortError');
  if (result.model.source !== source) throw new Error('Journal validation returned a different source. Keep your draft and retry.');
  return adopt(result.model);
}

export async function materializeJournalAsync(document: TodoDocument): Promise<TodoDocument> {
  if (isCanonicalJournal(document)) return document;
  if (typeof Worker === 'undefined') return materializeJournal(document);
  let result;
  try { result = await client().request({ kind: 'materialize', document }); }
  catch (error) { if (error instanceof JournalWorkerUnavailable) return materializeJournal(document); throw error; }
  return adopt(result.model).document;
}

export async function upgradeOutlineJournalAsync(document: TodoDocument) {
  if ((journalModel(document).format ?? 1) >= 2 || typeof Worker === 'undefined') return upgradeOutlineJournal(document);
  let result;
  try { result = await client().request({ kind: 'upgrade', document }); }
  catch (error) { if (error instanceof JournalWorkerUnavailable) return upgradeOutlineJournal(document); throw error; }
  return { document: adopt(result.model).document, checkboxChanges: result.checkboxChanges ?? 0 };
}

export async function upgradeWritingJournalAsync(document: TodoDocument) {
  if (journalModel(document).format === 3 || typeof Worker === 'undefined') return upgradeWritingJournal(document);
  let result;
  try { result = await client().request({ kind: 'upgrade-writing', document }); }
  catch (error) { if (error instanceof JournalWorkerUnavailable) return upgradeWritingJournal(document); throw error; }
  return { document: adopt(result.model).document, checkboxChanges: result.checkboxChanges ?? 0 };
}

export async function editMarkdownPassageAsync(source: string, range: SourceRange, markdown: string, links: MarkdownLinkPreparation[] = []) {
  if (typeof Worker === 'undefined') return journalFromPlanner(editMarkdownPassage(source, range, markdown, links)).document;
  let result;
  try { result = await client().request({ kind: 'passage', source, range, markdown, links }); }
  catch (error) { if (error instanceof JournalWorkerUnavailable) return journalFromPlanner(editMarkdownPassage(source, range, markdown, links)).document; throw error; }
  return adopt(result.model).document;
}

export async function writeJournalAsync(source: string, operation: WritingOperation) {
  if (typeof Worker === 'undefined') return journalFromPlanner(runWritingOperation(source, operation)).document;
  let result;
  try { result = await client().request({ kind: 'writing', source, operation }); }
  catch (error) { if (error instanceof JournalWorkerUnavailable) return journalFromPlanner(runWritingOperation(source, operation)).document; throw error; }
  return adopt(result.model).document;
}
