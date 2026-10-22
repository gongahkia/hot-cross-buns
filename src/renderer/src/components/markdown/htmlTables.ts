/** Find the whole table, including nested tables, without truncating a cell. */
export function htmlTableEnd(source: string): number {
  if (!/^<table\b/i.test(source)) return -1;
  let depth = 0;
  for (const match of source.matchAll(/<\/?table\b[^>]*>/gi)) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (depth === 0) return match.index! + match[0].length;
  }
  return -1;
}

export function splitHtmlTables(body: string): Array<{ kind: "markdown" | "htmlTable"; body: string }> {
  const segments: Array<{ kind: "markdown" | "htmlTable"; body: string }> = [];
  let fence: { marker: string; length: number } | null = null;
  let offset = 0; let start = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf("\n", offset);
    const end = lineEnd < 0 ? body.length : lineEnd + 1;
    const line = body.slice(offset, end);
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
    } else if (!fence && /^<table\b/i.test(line)) {
      const tableEnd = htmlTableEnd(body.slice(offset));
      if (tableEnd >= 0) {
        if (offset > start) segments.push({ kind: "markdown", body: body.slice(start, offset) });
        segments.push({ kind: "htmlTable", body: body.slice(offset, offset + tableEnd) });
        offset += tableEnd; start = offset; continue;
      }
    }
    offset = end;
  }
  if (start < body.length || !segments.length) segments.push({ kind: "markdown", body: body.slice(start) });
  return segments;
}
