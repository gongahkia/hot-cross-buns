import { performance } from "node:perf_hooks";
import type { StartupTimingSnapshot } from "@shared/ipc/contracts";

type StartupTimingName = keyof StartupTimingSnapshot;

const startedAt = performance.now();
const timings: StartupTimingSnapshot = {
  processStartedMs: 0
};

export function markStartupTiming(name: StartupTimingName): StartupTimingSnapshot {
  if (timings[name] === undefined) {
    timings[name] = Math.round(performance.now() - startedAt);
  }

  return getStartupTimings();
}

export function getStartupTimings(): StartupTimingSnapshot {
  return { ...timings };
}
