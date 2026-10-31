export const supportedFontFamilies = ['DM Sans', 'DM Serif Display', 'Inter'] as const;

/** Old system/custom font preferences resolve to the bundled default. */
export function resolveFontName(value: string | null | undefined): string {
  return supportedFontFamilies.find(font => font === value?.trim()) ?? 'DM Sans';
}

export function appFontStack(value: string | null | undefined): string {
  const name = resolveFontName(value);
  return `"${name}", ${name === 'DM Serif Display' ? 'serif' : 'sans-serif'}`;
}
