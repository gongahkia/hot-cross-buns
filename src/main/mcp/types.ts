export type MaybePromise<T> = T | Promise<T>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type McpPermissionMode = "read-only" | "confirm-writes" | "allow-writes";

export interface McpCredentialAdapter {
  loadBearerToken: () => MaybePromise<string>;
  credentialRevision?: () => MaybePromise<string>;
}

export interface McpPermissionProvider {
  getMode: () => MaybePromise<McpPermissionMode>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations?: JsonObject;
  kind: "read" | "write";
  destructive: boolean;
}

export interface PublicMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations?: JsonObject;
}

export interface McpToolCallContext {
  permissionMode: McpPermissionMode;
  credentialRevision: string;
  clientKey: string;
  now: Date;
}

export interface McpToolResponse {
  applied: boolean;
  dryRun: boolean;
  requiresConfirmation: boolean;
  confirmationId?: string;
  message: string;
  item?: JsonObject;
  items?: JsonObject[];
  deepLink?: string;
}

export type McpAuditOutcome =
  | "succeeded"
  | "dry_run"
  | "applied"
  | "denied"
  | "confirmation_required"
  | "invalid"
  | "failed"
  | "rate_limited";

export interface McpAuditEvent {
  timestamp: string;
  client: string;
  method: string;
  toolName?: string;
  outcome: McpAuditOutcome;
  isWrite: boolean;
  metadata: Record<string, string>;
}

export interface McpAuditRecorder {
  record: (event: McpAuditEvent) => MaybePromise<void>;
}

export type McpMetricOutcome = "success" | "rejected" | "error" | "rate_limited";

export interface McpMetricEvent {
  method: string;
  toolName?: string;
  status: number;
  outcome: McpMetricOutcome;
  durationMs: number;
}

export interface McpMetricsRecorder {
  record: (event: McpMetricEvent) => void;
  snapshot: () => McpMetricsSnapshot;
}

export interface McpMetricsRouteSnapshot {
  route: string;
  totalCalls: number;
  successCount: number;
  rejectedCount: number;
  errorCount: number;
  rateLimitedCount: number;
  averageDurationMs: number;
  lastDurationMs?: number;
  lastStatus?: number;
  lastSeenAt?: string;
}

export interface McpMetricsSnapshot {
  totalRequests: number;
  successCount: number;
  rejectedCount: number;
  errorCount: number;
  rateLimitedCount: number;
  routes: McpMetricsRouteSnapshot[];
}
