export const REDACTED_VALUE = "[redacted]";
export const DIAGNOSTIC_REDACTED_VALUE = "[REDACTED]";
export const DIAGNOSTIC_OMITTED_VALUE = "[OMITTED]";

const MAX_REDACTED_TEXT_LENGTH = 500;

const secretAssignmentPattern =
  /\b[A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|mcp[_-]?token|bearer[_-]?token|api[_-]?key|password|credential|secret|token)[A-Za-z0-9_-]*\b\s*([:=])\s*["']?[^"',\s)}\]]+/gi;
const jsonSecretPattern =
  /(["'])(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|mcp[_-]?token|bearer[_-]?token|api[_-]?key|password|credential|secret|token)\1\s*:\s*(["'])(?:(?!\3).)*\3/gi;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const oauthCodePattern = /\b(code|code_verifier|codeVerifier|state)=([^&\s]+)/gi;
const googleApiKeyPattern = /\bAIza[0-9A-Za-z_-]{20,}\b/g;
const likelyJwtPattern = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const macUserPathPattern = /\/Users\/[^/\s]+/g;
const linuxUserPathPattern = /\/home\/[^/\s]+/g;
const windowsUserPathPattern = /[A-Z]:\\Users\\[^\\\s]+/gi;
const homeDirectory = typeof process === "undefined" ? undefined : process.env.HOME;
const diagnosticSensitiveKeyPattern =
  /(access[_-]?token|refresh[_-]?token|id[_-]?token|bearer|authorization|credential|client[_-]?secret|mcp[_-]?(?:bearer[_-]?)?token|secret|password)/i;
const diagnosticRawPayloadKeyPattern =
  /(raw[_-]?google|google[_-]?payload|payload_json|raw[_-]?payload)/i;
const diagnosticSensitiveBodyKeyPattern =
  /(^body$|^note$|^notes$|description|details|location|attendee|guest|summary|title|eventBody|taskBody|noteBody)/i;

export type RedactablePrimitive = string | number | boolean | null;

export function redactSensitiveText(value: string, maxLength = MAX_REDACTED_TEXT_LENGTH): string {
  const redacted = value
    .replace(jsonSecretPattern, (_match, quote: string, key: string) => `${quote}${key}${quote}: "${REDACTED_VALUE}"`)
    .replace(secretAssignmentPattern, (match: string, separator: string) => {
      const key = match.slice(0, match.indexOf(separator)).trim();
      return `${key}${separator}${REDACTED_VALUE}`;
    })
    .replace(bearerPattern, `Bearer ${REDACTED_VALUE}`)
    .replace(oauthCodePattern, (_match, key: string) => `${key}=${REDACTED_VALUE}`)
    .replace(googleApiKeyPattern, REDACTED_VALUE)
    .replace(likelyJwtPattern, REDACTED_VALUE)
    .replace(emailPattern, REDACTED_VALUE)
    .replace(macUserPathPattern, "~")
    .replace(linuxUserPathPattern, "~")
    .replace(windowsUserPathPattern, "~")
    .replace(/[\r\n]+/g, " ")
    .trim();
  const withoutHome = homeDirectory ? redacted.split(homeDirectory).join("~") : redacted;

  return withoutHome.slice(0, maxLength);
}

export function redactDiagnosticText(value: string): string {
  return redactSensitiveText(value)
    .replaceAll(REDACTED_VALUE, DIAGNOSTIC_REDACTED_VALUE)
    .replace(
      /\b[A-Za-z0-9_-]*(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|mcp[_-]?(?:bearer[_-]?)?token|bearer[_-]?token|api[_-]?key|password|credential|secret|token)[A-Za-z0-9_-]*\b\s*[:=]\s*\[REDACTED\]/gi,
      DIAGNOSTIC_REDACTED_VALUE
    );
}

export function redactDiagnosticsValue(value: unknown): unknown {
  return redactDiagnosticValue(value, undefined);
}

export function redactErrorMessage(message: string): string {
  return redactSensitiveText(message);
}

export function redactLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactLogValue);
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      output[redactSensitiveKey(key)] = isSensitiveKey(key)
        ? REDACTED_VALUE
        : redactLogValue(nestedValue);
    }

    return output;
  }

  return REDACTED_VALUE;
}

export function redactDiagnosticDetails(
  details: Record<string, RedactablePrimitive> | undefined
): Record<string, RedactablePrimitive> | undefined {
  if (details === undefined) {
    return undefined;
  }

  const sanitized: Record<string, RedactablePrimitive> = {};

  for (const [key, value] of Object.entries(details)) {
    const redactedKey = redactSensitiveKey(key);

    if (isSensitiveKey(key)) {
      sanitized[redactedKey] = REDACTED_VALUE;
      continue;
    }

    sanitized[redactedKey] =
      typeof value === "string" ? redactSensitiveText(value) : value;
  }

  return sanitized;
}

export function redactAuditText(value: string, maxLength = 120): string {
  return redactSensitiveText(value, maxLength);
}

export function redactMetadata(
  metadata: Record<string, RedactablePrimitive> | undefined
): Record<string, RedactablePrimitive> {
  return redactDiagnosticDetails(metadata) ?? {};
}

export function redactSensitiveKey(key: string): string {
  return isSensitiveKey(key) ? REDACTED_VALUE : redactSensitiveText(key, 120);
}

export function isSensitiveKey(key: string): boolean {
  return /(?:access|refresh|id|bearer|mcp)?[_-]?(?:token|secret|password|credential|api[_-]?key)|code[_-]?verifier/i.test(
    key
  );
}

function redactDiagnosticValue(value: unknown, key: string | undefined): unknown {
  if (key && diagnosticRawPayloadKeyPattern.test(key)) {
    return DIAGNOSTIC_REDACTED_VALUE;
  }

  if (key && diagnosticSensitiveKeyPattern.test(key)) {
    return DIAGNOSTIC_REDACTED_VALUE;
  }

  if (key && diagnosticSensitiveBodyKeyPattern.test(key)) {
    return DIAGNOSTIC_OMITTED_VALUE;
  }

  if (typeof value === "string") {
    return redactDiagnosticText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item, key));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = redactDiagnosticValue(childValue, childKey);
    }

    return output;
  }

  return value;
}
