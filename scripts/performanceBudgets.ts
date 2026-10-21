/**
 * Targets describe the desired experience. Regression ceilings catch a clear
 * deterioration of the Linux/Xvfb baseline without presenting that baseline
 * as a universal hardware guarantee. Keep target misses visible in reports.
 */
export const latencyBudgets = [
  { prefix: "cold-shell-visible", targetMs: 1500, ceilingMs: 2000 },
  { prefix: "cached-profile-shell-visible", targetMs: 1500, ceilingMs: 2000 },
  { prefix: "cached-profile-content-visible", targetMs: 1500, ceilingMs: 2500 },
  { prefix: "main-ipc-during-writes-p95", targetMs: 20, ceilingMs: 20 },
  { prefix: "pending-outbox-query-", targetMs: 30, ceilingMs: 100 },
  { prefix: "task-reorder-warm", targetMs: 100, ceilingMs: 100 },
  { prefix: "fts-search-", targetMs: 100, ceilingMs: 100 },
  { prefix: "renderer-cold-hydration-", targetMs: 300, ceilingMs: 1000 },
  { prefix: "tasks-scroll-to-end", targetMs: 300, ceilingMs: 500 },
  { prefix: "tasks-scroll-frame-p95", targetMs: 32, ceilingMs: 50 },
  // Two animation frames include a ~33 ms floor on a 60 Hz display.
  { prefix: "task-title-input-to-paint-p95", targetMs: 50, ceilingMs: 100 },
  { prefix: "renderer-notes-", targetMs: 300, ceilingMs: 500 },
  { prefix: "notes-scroll-to-end", targetMs: 300, ceilingMs: 500 },
  { prefix: "renderer-calendar-agenda-", targetMs: 300, ceilingMs: 500 },
  { prefix: "renderer-tasks-warm-navigation", targetMs: 300, ceilingMs: 500 }
] as const;

export interface BudgetResult {
  name: string;
  unit: "ms" | "MiB";
  actual: number;
  target: number;
  ceiling: number;
  status: "target-met" | "target-missed" | "regression";
}

export function evaluatePerformanceBudgets(measurements: ReadonlyArray<{ name: string; durationMs: number }>, resources: ReadonlyArray<{ pssMiB: number | null; rendererHeapMiB: number | null }>): BudgetResult[] {
  function result(name: string, unit: BudgetResult["unit"], actual: number, target: number, ceiling: number): BudgetResult {
    return { name, unit, actual, target, ceiling, status: actual > ceiling ? "regression" : actual > target ? "target-missed" : "target-met" };
  }
  const budgets = latencyBudgets.map(({ prefix, targetMs, ceilingMs }) => {
    const measurement = measurements.find(({ name }) => name.startsWith(prefix));
    if (!measurement) throw new Error(`Performance budget has no measurement: ${prefix}`);
    return result(measurement.name, "ms", measurement.durationMs, targetMs, ceilingMs);
  });
  const heaps = resources.flatMap(({ rendererHeapMiB }) => rendererHeapMiB === null ? [] : [rendererHeapMiB]);
  if (heaps.length) budgets.push(result("maximum-renderer-js-heap", "MiB", Math.max(...heaps), 32, 64));
  const pss = resources.flatMap(({ pssMiB }) => pssMiB === null ? [] : [pssMiB]);
  if (pss.length) budgets.push(result("maximum-sampled-electron-pss", "MiB", Math.max(...pss), 500, 650));
  return budgets;
}
