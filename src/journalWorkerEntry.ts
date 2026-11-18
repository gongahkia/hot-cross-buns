import { runJournalWork, type JournalWorkRequest, type JournalWorkResult } from './journalWorker.ts';

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<JournalWorkRequest>) => void; postMessage: (result: JournalWorkResult) => void };
scope.onmessage = event => {
  const started = event.data.profile ? performance.now() : undefined;
  const result = runJournalWork(event.data);
  scope.postMessage(started === undefined ? result : { ...result, workerMs: performance.now() - started });
};
