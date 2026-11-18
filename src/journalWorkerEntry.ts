import { createJournalWorkerHost, type JournalWorkRequest, type JournalWireResult } from './journalWorker.ts';

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<JournalWorkRequest>) => void; postMessage: (result: JournalWireResult) => void };
const respond = createJournalWorkerHost();
scope.onmessage = event => scope.postMessage(respond(event.data));
