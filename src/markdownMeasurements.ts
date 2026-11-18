export type MarkdownMeasurement = { phase: string; milliseconds: number; characters?: number };
type Measurements = { enabled: boolean; samples: MarkdownMeasurement[] };
const measurements = () => (globalThis as typeof globalThis & { __hcbMarkdownMetrics?: Measurements }).__hcbMarkdownMetrics;
export const markdownMeasurementsEnabled = () => measurements()?.enabled === true;
export const startMarkdownMeasurement = () => markdownMeasurementsEnabled() ? performance.now() : undefined;

export function recordMarkdownDuration(phase: string, milliseconds: number, characters?: number): void {
  const state = measurements();
  if (!state?.enabled || !Number.isFinite(milliseconds) || milliseconds < 0) return;
  if (state.samples.length >= 1000) state.samples.shift();
  state.samples.push({ phase, milliseconds, ...(characters === undefined ? {} : { characters }) });
}

export function finishMarkdownMeasurement(phase: string, started?: number, characters?: number): void {
  if (started !== undefined) recordMarkdownDuration(phase, performance.now() - started, characters);
}
