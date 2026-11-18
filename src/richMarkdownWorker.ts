import { runRichMarkdownWork, type RichMarkdownWork } from './richMarkdownWork.ts';

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<RichMarkdownWork & { id: number }>) => void; postMessage: (value: unknown) => void };
scope.onmessage = event => {
  void runRichMarkdownWork(event.data).then(result => scope.postMessage({ id: event.data.id, result }), error => scope.postMessage({ id: event.data.id, error: String(error) }));
};
