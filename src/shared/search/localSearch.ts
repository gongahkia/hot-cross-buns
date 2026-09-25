export type ParsedLocalSearchQuery = any;
export function parseLocalSearchQuery(value: string): ParsedLocalSearchQuery {
  const terms = value.trim().split(/\\s+/).filter(Boolean);
  return { terms, errors: [] };
}
