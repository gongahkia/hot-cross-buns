export type TimeBlock = { start: string; end: string; title: string };

export function validTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour <= 23 && minute <= 59;
}

export function parseTimeBlock(text: string): TimeBlock | null {
  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2}) (.+)$/.exec(text);
  if (!match || !validTime(match[1]) || !validTime(match[2]) || match[1] >= match[2]) return null;
  return { start: match[1], end: match[2], title: match[3] };
}

export function setTimeBlock(text: string, start: string | null, end: string | null): string {
  const title = parseTimeBlock(text)?.title ?? text;
  return start && end ? `${start}-${end} ${title}` : title;
}
