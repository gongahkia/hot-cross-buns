export function plannerExternalUrl(value: string | null, baseUrl: string): string | null {
  if (!value || value.trim().startsWith("#")) return null;
  try {
    const url = new URL(value, baseUrl);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
