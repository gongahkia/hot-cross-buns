import { z } from "zod";
import { hcbResultSchema } from "./result";

export const appEnvironmentSchema = z.enum(["development", "test", "production"]);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export const startupTimingSnapshotSchema = z
  .object({
    processStartedMs: z.number().nonnegative().optional(),
    appReadyMs: z.number().nonnegative().optional(),
    windowCreatedMs: z.number().nonnegative().optional(),
    rendererLoadedMs: z.number().nonnegative().optional(),
    shellVisibleMs: z.number().nonnegative().optional()
  })
  .strict();

export type StartupTimingSnapshot = z.infer<typeof startupTimingSnapshotSchema>;

export const healthCheckRequestSchema = z.object({}).strict();
export type HealthCheckRequest = z.infer<typeof healthCheckRequestSchema>;

export const healthCheckResponseSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string().min(1),
    environment: appEnvironmentSchema,
    timestamp: z.string().datetime(),
    uptimeMs: z.number().nonnegative(),
    startup: startupTimingSnapshotSchema
  })
  .strict();

export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;

export const healthCheckResultSchema = hcbResultSchema(healthCheckResponseSchema);

export const shellVisibleRequestSchema = z
  .object({
    rendererNowMs: z.number().finite().nonnegative().optional()
  })
  .strict();

export type ShellVisibleRequest = z.infer<typeof shellVisibleRequestSchema>;

export const shellVisibleResultSchema = hcbResultSchema(startupTimingSnapshotSchema);
