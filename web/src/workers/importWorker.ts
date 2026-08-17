import { parseImport } from "@/features/importParser";

self.onmessage = (event: MessageEvent<{ readonly id: number; readonly name: string; readonly text: string }>) => {
  const { id, name, text } = event.data;
  self.postMessage({ id, preview: parseImport(name, text) });
};
