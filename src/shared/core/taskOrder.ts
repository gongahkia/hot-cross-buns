/** ASCII keys whose byte order is SQLite's BINARY order. Never end on the minimum character. */
export function taskOrderBetween(left: string | null, right: string | null): string | null {
  if (left !== null && right !== null && left >= right) return null;
  let prefix = "";
  for (let index = 0; index < 256; index += 1) {
    const lower = left?.charCodeAt(0) || 31;
    const upper = right === null ? 127 : right.charCodeAt(0) || 31;
    if (lower === upper) {
      if (lower === 31) return null;
      prefix += String.fromCharCode(lower);
      left = left!.slice(1); right = right!.slice(1);
    } else if (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2);
      return prefix + String.fromCharCode(middle) + (middle === 32 ? "O" : "");
    } else if (!left?.length) {
      if (!right?.length) return null;
      prefix += right[0]; right = right.slice(1); left = null;
    } else {
      prefix += left[0]; left = left.slice(1); right = null;
    }
  }
  return null;
}
