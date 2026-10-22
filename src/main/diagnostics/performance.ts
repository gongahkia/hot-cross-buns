import { performance } from "node:perf_hooks";

interface Timing { kind: string; name: string; durationMs: number; recordedAt: string }
const samples: Timing[] = [];

export function recordTiming(input: Record<string, unknown>): boolean {
  if (typeof input.name !== "string" || input.name.length > 120 || typeof input.kind !== "string" || input.kind.length > 40 || typeof input.durationMs !== "number" || !Number.isFinite(input.durationMs) || input.durationMs < 0) return false;
  samples.push({ kind: input.kind, name: input.name, durationMs: Math.round(input.durationMs * 100) / 100, recordedAt: new Date().toISOString() });
  if (samples.length > 200) samples.splice(0, samples.length - 200);
  return true;
}

export function timingSnapshot(): Timing[] { return samples.map((sample) => ({ ...sample })); }

export function timed<T>(name: string, kind: string, action: () => T): T {
  const start = performance.now();
  try { return action(); }
  finally { recordTiming({ name, kind, durationMs: performance.now() - start }); }
}
