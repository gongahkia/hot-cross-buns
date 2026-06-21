import type { McpMetricEvent, McpMetricsRecorder, McpMetricsRouteSnapshot } from "./types";

interface MutableRouteMetric {
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

function routeFor(event: McpMetricEvent): string {
  return event.toolName ? `${event.method}:${event.toolName}` : event.method;
}

export function createMcpMetrics(): McpMetricsRecorder {
  const routes = new Map<string, MutableRouteMetric>();

  return {
    record: (event) => {
      const route = routeFor(event);
      const metric =
        routes.get(route) ??
        ({
          route,
          totalCalls: 0,
          successCount: 0,
          rejectedCount: 0,
          errorCount: 0,
          rateLimitedCount: 0,
          averageDurationMs: 0
        } satisfies MutableRouteMetric);

      metric.totalCalls += 1;
      metric.averageDurationMs =
        (metric.averageDurationMs * (metric.totalCalls - 1) + event.durationMs) /
        metric.totalCalls;
      metric.lastDurationMs = event.durationMs;
      metric.lastStatus = event.status;
      metric.lastSeenAt = new Date().toISOString();

      if (event.outcome === "success") {
        metric.successCount += 1;
      } else if (event.outcome === "rate_limited") {
        metric.rateLimitedCount += 1;
      } else if (event.outcome === "error") {
        metric.errorCount += 1;
      } else {
        metric.rejectedCount += 1;
      }

      routes.set(route, metric);
    },
    snapshot: () => {
      const routeSnapshots: McpMetricsRouteSnapshot[] = [...routes.values()]
        .sort((left, right) => left.route.localeCompare(right.route))
        .map((metric) => ({
          route: metric.route,
          totalCalls: metric.totalCalls,
          successCount: metric.successCount,
          rejectedCount: metric.rejectedCount,
          errorCount: metric.errorCount,
          rateLimitedCount: metric.rateLimitedCount,
          averageDurationMs: Math.round(metric.averageDurationMs * 100) / 100,
          ...(metric.lastDurationMs === undefined ? {} : { lastDurationMs: metric.lastDurationMs }),
          ...(metric.lastStatus === undefined ? {} : { lastStatus: metric.lastStatus }),
          ...(metric.lastSeenAt === undefined ? {} : { lastSeenAt: metric.lastSeenAt })
        }));

      return {
        totalRequests: routeSnapshots.reduce((total, route) => total + route.totalCalls, 0),
        successCount: routeSnapshots.reduce((total, route) => total + route.successCount, 0),
        rejectedCount: routeSnapshots.reduce((total, route) => total + route.rejectedCount, 0),
        errorCount: routeSnapshots.reduce((total, route) => total + route.errorCount, 0),
        rateLimitedCount: routeSnapshots.reduce(
          (total, route) => total + route.rateLimitedCount,
          0
        ),
        routes: routeSnapshots.slice(0, 100)
      };
    }
  };
}
