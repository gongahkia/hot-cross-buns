import {
  redactDiagnosticText as redactCentralDiagnosticText,
  redactDiagnosticsValue as redactCentralDiagnosticsValue
} from "@shared/redaction";

export function redactDiagnosticsValue(value: unknown): unknown {
  return redactCentralDiagnosticsValue(value);
}

export function redactDiagnosticText(value: string): string {
  return redactCentralDiagnosticText(value);
}
