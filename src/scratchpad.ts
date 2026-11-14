export type ScratchpadMapping = 'details' | 'items' | 'single';
export type ScratchpadMoveMode = 'cut' | 'ask';

export function mapScratchpadSelection(text: string, mapping: ScratchpadMapping): Array<{ title: string; details: string[] }> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (mapping === 'items') return lines.map(title => ({ title, details: [] }));
  if (mapping === 'single') return [{ title: lines.join(' '), details: [] }];
  return [{ title: lines[0], details: lines.slice(1) }];
}
