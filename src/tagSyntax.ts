export const normalizeTag = (name: string) => name.normalize('NFKC').toLowerCase();
export function tagMatches(text: string) {
  const urls = [...text.matchAll(/https?:\/\/\S+/gi)].map(match => [match.index, match.index + match[0].length]);
  return [...text.matchAll(/(?<![\p{L}\p{N}_/#&])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,63})(?![\p{L}\p{N}_-])/gu)]
    .filter(match => !urls.some(([from, to]) => match.index >= from && match.index < to))
    .map(match => ({ from: match.index, to: match.index + match[0].length, name: normalizeTag(match[1]), text: match[0] }));
}
