import { Profiler, useEffect, useRef } from "react";
import type { ProfilerOnRenderCallback, ReactNode } from "react";

const renderProfilingEnabled =
  import.meta.env.MODE === "performance" || import.meta.env.VITE_HCB_RENDER_PROFILING === "true";

function reportRenderTiming(label: string, durationMs: number): void {
  if (!renderProfilingEnabled) {
    return;
  }

  console.debug("[hcb-render]", {
    durationMs: Number(durationMs.toFixed(2)),
    label
  });
}

export function useRenderTiming(label: string): void {
  const startedAt = useRef<number | null>(null);

  if (renderProfilingEnabled && typeof performance !== "undefined") {
    startedAt.current = performance.now();
  }

  useEffect(() => {
    if (!renderProfilingEnabled || startedAt.current === null || typeof performance === "undefined") {
      return;
    }

    reportRenderTiming(label, performance.now() - startedAt.current);
  });
}

const handleProfilerRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration
): void => {
  reportRenderTiming(`${id}:${phase}`, actualDuration);
};

export function RenderTimingBoundary({
  children,
  id
}: {
  children: ReactNode;
  id: string;
}): JSX.Element {
  if (!renderProfilingEnabled) {
    return <>{children}</>;
  }

  return (
    <Profiler id={id} onRender={handleProfilerRender}>
      {children}
    </Profiler>
  );
}
