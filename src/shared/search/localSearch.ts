export interface ParsedLocalSearchQuery {
  terms: string[];
  explain: string[];
  errors: Array<{ message: string }>;
}

export function parseLocalSearchQuery(value: string): ParsedLocalSearchQuery {
  const terms = value.trim().split(/\s+/).filter(Boolean);

  return {
    terms,
    // The command palette consumes this field even when no advanced search
    // filters are present. Keeping the parser's public shape complete means
    // an incomplete query can never take down the renderer.
    explain: terms.map((term) => `Text: ${term}`),
    errors: []
  };
}
