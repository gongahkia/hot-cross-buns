const secretPattern = /((?:access|refresh)[-_ ]?token|client[_ -]?secret|authorization)\\s*[:=]\\s*[^\\s,;]+/gi;

export function redactDiagnosticText(value: string): string {
  return value.replace(secretPattern, "$1=[redacted]");
}

