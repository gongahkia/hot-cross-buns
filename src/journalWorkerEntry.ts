import { runJournalWork, type JournalWorkRequest, type JournalWorkResult } from './journalWorker.ts';

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<JournalWorkRequest>) => void; postMessage: (result: JournalWorkResult) => void };
scope.onmessage = event => scope.postMessage(runJournalWork(event.data));
