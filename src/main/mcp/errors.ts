export type McpToolErrorCode =
  | "UNKNOWN_TOOL"
  | "INVALID_ARGUMENTS"
  | "PERMISSION_DENIED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_MISMATCH"
  | "NOT_FOUND"
  | "MUTATION_FAILED";

export class McpToolError extends Error {
  readonly code: McpToolErrorCode;
  readonly confirmationId?: string;

  constructor(code: McpToolErrorCode, message: string, confirmationId?: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    this.confirmationId = confirmationId;
  }
}

export function jsonRpcErrorCode(error: McpToolError): number {
  switch (error.code) {
    case "UNKNOWN_TOOL":
      return -32601;
    case "INVALID_ARGUMENTS":
    case "CONFIRMATION_MISMATCH":
    case "NOT_FOUND":
      return -32602;
    case "PERMISSION_DENIED":
    case "CONFIRMATION_REQUIRED":
      return -32001;
    case "MUTATION_FAILED":
      return -32002;
  }
}
