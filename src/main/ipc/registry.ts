import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  HCB_IPC_CHANNEL,
  type IpcContract,
  type IpcDispatchEnvelope,
  diagnosticsIpcMetricsResponseSchema,
  ipcDispatchEnvelopeSchema
} from "@shared/ipc/contracts";
import {
  err,
  internalError,
  ok,
  sanitizeThrownError,
  validationError,
  type HcbErrorCode,
  type HcbResult
} from "@shared/ipc/result";

export interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, payload: unknown) => Promise<HcbResult<unknown>>
  ) => void;
}

export interface IpcHandlerContext {
  route: string;
}

export interface IpcHandlerDefinition<Request = unknown, Response = unknown> {
  contract: IpcContract;
  handle: (request: Request, context: IpcHandlerContext) => Promise<Response> | Response;
}

type IpcMetricOutcome = "success" | "validation_error" | "service_error" | "response_error";

export interface IpcMetricEvent {
  route: string;
  durationMs: number;
  outcome: IpcMetricOutcome;
  errorCode?: HcbErrorCode;
}

export interface IpcMetricsRecorder {
  record: (event: IpcMetricEvent) => void;
  snapshot: () => z.infer<typeof diagnosticsIpcMetricsResponseSchema>;
}

export interface IpcDiagnosticsLogger {
  debug: (event: IpcLogEvent) => void;
}

export interface IpcLogEvent {
  channel: typeof HCB_IPC_CHANNEL;
  route: string;
  durationMs: number;
  outcome: IpcMetricOutcome;
  errorCode?: HcbErrorCode;
}

export interface IpcDispatcherOptions {
  metrics?: IpcMetricsRecorder;
  logger?: IpcDiagnosticsLogger;
  now?: () => number;
}

interface MutableRouteMetric {
  route: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  validationFailures: number;
  serviceFailures: number;
  responseFailures: number;
  averageDurationMs: number;
  lastDurationMs?: number;
  lastErrorCode?: HcbErrorCode;
  lastSeenAt?: string;
}

function routeKey(contract: IpcContract): string {
  return `${contract.domain}.${contract.method}`;
}

function durationSince(startedAt: number, now: () => number): number {
  return Math.max(0, Math.round((now() - startedAt) * 100) / 100);
}

function validationDetails(error: z.ZodError): Record<string, string | number> {
  const paths = error.issues
    .map((issue) => issue.path.join("."))
    .filter((path) => path.length > 0)
    .slice(0, 8);

  return {
    issueCount: error.issues.length,
    paths: paths.length > 0 ? paths.join(",") : "<root>"
  };
}

function defaultDevLogger(): IpcDiagnosticsLogger | undefined {
  if (process.env.HCB_IPC_DEBUG !== "1") {
    return undefined;
  }

  return {
    debug: (event) => {
      console.debug("[hcb:ipc]", JSON.stringify(event));
    }
  };
}

export function createIpcMetrics(): IpcMetricsRecorder {
  const routes = new Map<string, MutableRouteMetric>();

  return {
    record: (event) => {
      const routeMetric =
        routes.get(event.route) ??
        ({
          route: event.route,
          totalCalls: 0,
          successCount: 0,
          failureCount: 0,
          validationFailures: 0,
          serviceFailures: 0,
          responseFailures: 0,
          averageDurationMs: 0
        } satisfies MutableRouteMetric);

      routeMetric.totalCalls += 1;
      routeMetric.averageDurationMs =
        (routeMetric.averageDurationMs * (routeMetric.totalCalls - 1) + event.durationMs) /
        routeMetric.totalCalls;
      routeMetric.lastDurationMs = event.durationMs;
      routeMetric.lastSeenAt = new Date().toISOString();

      if (event.outcome === "success") {
        routeMetric.successCount += 1;
        delete routeMetric.lastErrorCode;
      } else {
        routeMetric.failureCount += 1;
        routeMetric.lastErrorCode = event.errorCode;
      }

      if (event.outcome === "validation_error") {
        routeMetric.validationFailures += 1;
      }

      if (event.outcome === "service_error") {
        routeMetric.serviceFailures += 1;
      }

      if (event.outcome === "response_error") {
        routeMetric.responseFailures += 1;
      }

      routes.set(event.route, routeMetric);
    },
    snapshot: () => {
      const routeSnapshots = [...routes.values()]
        .sort((left, right) => left.route.localeCompare(right.route))
        .map((routeMetric) => ({
          route: routeMetric.route,
          totalCalls: routeMetric.totalCalls,
          successCount: routeMetric.successCount,
          failureCount: routeMetric.failureCount,
          validationFailures: routeMetric.validationFailures,
          serviceFailures: routeMetric.serviceFailures,
          responseFailures: routeMetric.responseFailures,
          averageDurationMs: Math.round(routeMetric.averageDurationMs * 100) / 100,
          ...(routeMetric.lastDurationMs === undefined
            ? {}
            : { lastDurationMs: routeMetric.lastDurationMs }),
          ...(routeMetric.lastErrorCode === undefined
            ? {}
            : { lastErrorCode: routeMetric.lastErrorCode }),
          ...(routeMetric.lastSeenAt === undefined ? {} : { lastSeenAt: routeMetric.lastSeenAt })
        }));

      return diagnosticsIpcMetricsResponseSchema.parse({
        totalCalls: routeSnapshots.reduce((total, route) => total + route.totalCalls, 0),
        validationFailures: routeSnapshots.reduce(
          (total, route) => total + route.validationFailures,
          0
        ),
        serviceFailures: routeSnapshots.reduce((total, route) => total + route.serviceFailures, 0),
        responseFailures: routeSnapshots.reduce(
          (total, route) => total + route.responseFailures,
          0
        ),
        routes: routeSnapshots.slice(0, 100)
      });
    }
  };
}

export function createIpcDispatcher(
  definitions: readonly IpcHandlerDefinition[],
  options: IpcDispatcherOptions = {}
): (event: unknown, payload: unknown) => Promise<HcbResult<unknown>> {
  const now = options.now ?? (() => performance.now());
  const logger = options.logger ?? defaultDevLogger();
  const handlers = new Map<string, IpcHandlerDefinition>();

  for (const definition of definitions) {
    const key = routeKey(definition.contract);

    if (handlers.has(key)) {
      throw new Error(`Duplicate IPC handler registered for ${key}`);
    }

    handlers.set(key, definition);
  }

  function finish<T>(
    route: string,
    startedAt: number,
    outcome: IpcMetricOutcome,
    result: HcbResult<T>
  ): HcbResult<T> {
    const durationMs = durationSince(startedAt, now);
    const errorCode = result.ok ? undefined : result.error.code;
    const metricEvent = {
      route,
      durationMs,
      outcome,
      ...(errorCode === undefined ? {} : { errorCode })
    };

    options.metrics?.record(metricEvent);
    logger?.debug({
      channel: HCB_IPC_CHANNEL,
      ...metricEvent
    });

    return result;
  }

  return async (_event: unknown, payload: unknown) => {
    const startedAt = now();
    const envelope = ipcDispatchEnvelopeSchema.safeParse(payload);

    if (!envelope.success) {
      return finish(
        "unknown",
        startedAt,
        "validation_error",
        validationError("Invalid IPC envelope", validationDetails(envelope.error))
      );
    }

    const parsedEnvelope: IpcDispatchEnvelope = envelope.data;
    const candidateRoute = `${parsedEnvelope.domain}.${parsedEnvelope.method}`;
    const definition = handlers.get(candidateRoute);

    if (!definition) {
      return finish(
        `${parsedEnvelope.domain}.unknown`,
        startedAt,
        "service_error",
        err({
          code: "NOT_IMPLEMENTED",
          message: "IPC method is not implemented",
          recoverable: false
        })
      );
    }

    const route = routeKey(definition.contract);
    const request = definition.contract.requestSchema.safeParse(parsedEnvelope.request);

    if (!request.success) {
      return finish(
        route,
        startedAt,
        "validation_error",
        validationError(`Invalid ${route} request`, validationDetails(request.error))
      );
    }

    try {
      const data = await definition.handle(request.data, { route });
      const response = definition.contract.responseSchema.safeParse(data);

      if (!response.success) {
        return finish(
          route,
          startedAt,
          "response_error",
          internalError("Invalid IPC response")
        );
      }

      return finish(route, startedAt, "success", ok(response.data));
    } catch (thrown) {
      const sanitized = sanitizeThrownError(thrown);

      return finish(route, startedAt, "service_error", err(sanitized));
    }
  };
}

export function registerIpcDispatcher(
  ipcMain: IpcMainLike,
  definitions: readonly IpcHandlerDefinition[],
  options: IpcDispatcherOptions = {}
): IpcMetricsRecorder {
  const metrics = options.metrics ?? createIpcMetrics();
  const dispatcher = createIpcDispatcher(definitions, {
    ...options,
    metrics
  });

  ipcMain.handle(HCB_IPC_CHANNEL, dispatcher);

  return metrics;
}
