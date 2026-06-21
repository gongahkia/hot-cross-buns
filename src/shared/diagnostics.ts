import { z } from "zod";
import {
  diagnosticsHealthRequestSchema,
  diagnosticsHealthResponseSchema,
  diagnosticsShellVisibleRequestSchema,
  startupTimingSnapshotSchema,
  type DiagnosticsHealthResponse,
  type DiagnosticsShellVisibleRequest,
  type StartupTimingSnapshot
} from "./ipc/contracts";
import { hcbResultSchema } from "./ipc/result";

export const appEnvironmentSchema = z.enum(["development", "test", "production"]);
export type AppEnvironment = DiagnosticsHealthResponse["environment"];

export { startupTimingSnapshotSchema };
export type { StartupTimingSnapshot };

export const healthCheckRequestSchema = diagnosticsHealthRequestSchema;
export type HealthCheckRequest = z.infer<typeof healthCheckRequestSchema>;

export const healthCheckResponseSchema = diagnosticsHealthResponseSchema;
export type HealthCheckResponse = DiagnosticsHealthResponse;

export const healthCheckResultSchema = hcbResultSchema(healthCheckResponseSchema);

export const shellVisibleRequestSchema = diagnosticsShellVisibleRequestSchema;
export type ShellVisibleRequest = DiagnosticsShellVisibleRequest;

export const shellVisibleResultSchema = hcbResultSchema(startupTimingSnapshotSchema);
