export interface StartupMetrics {
  startedAt: number;
  bootstrapCompletedAt: number | null;
  selectedListHydratedAt: number | null;
  firstInteractiveAt: number | null;
}

declare global {
  interface Window {
    __CROSS2_STARTUP_METRICS__?: StartupMetrics;
  }
}

const metrics: StartupMetrics = {
  startedAt: typeof performance !== 'undefined' ? performance.now() : 0,
  bootstrapCompletedAt: null,
  selectedListHydratedAt: null,
  firstInteractiveAt: null,
};

function publish(): void {
  if (typeof window !== 'undefined') {
    window.__CROSS2_STARTUP_METRICS__ = { ...metrics };
  }
}

function record(label: keyof Omit<StartupMetrics, 'startedAt'>): void {
  if (typeof performance === 'undefined') {
    return;
  }

  if (metrics[label] !== null) {
    return;
  }

  metrics[label] = performance.now();
  publish();
  console.info(`[startup] ${label} ${Math.round(metrics[label]! - metrics.startedAt)}ms`);
}

export function markBootstrapCompleted(): void {
  record('bootstrapCompletedAt');
}

export function markSelectedListHydrated(): void {
  record('selectedListHydratedAt');
}

export function markFirstInteractive(): void {
  record('firstInteractiveAt');
}

publish();
