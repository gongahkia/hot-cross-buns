const allowedSvgTags = new Set(["svg", "g", "path", "rect", "circle", "line", "polyline", "polygon", "ellipse"]);
const blockedSvgPattern =
  /<(script|foreignObject|iframe|object|embed|style|image|use)\b|(?:\s|<)on[a-z]+\s*=|\sstyle\s*=|\b(?:href|xlink:href)\s*=|url\s*\(/i;
const svgTagPattern = /<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/g;

export const calendarMenuBarIconBody =
  '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>';
export const calendarCheckMenuBarIconBody = `${calendarMenuBarIconBody}<path d="m9 16 2 2 4-4"/>`;

export function sanitizeMenuBarIconSvg(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("<svg") || !trimmed.endsWith("</svg>") || blockedSvgPattern.test(trimmed)) {
    return null;
  }

  const tags = [...trimmed.matchAll(svgTagPattern)];
  if (!tags.length || tags.some((tag) => !allowedSvgTags.has(tag[1].toLowerCase()))) {
    return null;
  }

  const inner = trimmed
    .replace(/^<svg\b[^>]*>/i, "")
    .replace(/<\/svg>$/i, "")
    .replace(/\sclass="[^"]*"/gi, "")
    .trim();

  return inner.length > 0 ? inner : null;
}

export function menuBarIconSvg(body: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
    body,
    "</svg>"
  ].join("");
}

export function menuBarIconDataUrl(body: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(menuBarIconSvg(body))}`;
}
