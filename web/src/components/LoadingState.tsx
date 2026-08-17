import { useEffect, useState } from "react";

export type LoadingVariant = "Drive" | "Dots" | "Orbit";

interface LoadingStateProps {
  readonly label?: string;
  readonly variant?: LoadingVariant;
  readonly className?: string;
  /** Optional startup/status sequence; the first label is shown before rotation begins. */
  readonly rotatingLabels?: readonly string[];
  readonly labelRotationMs?: number;
}

const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});
const orbitOrder = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, index) => {
  const position = orbitOrder.indexOf(index);
  return position === -1 ? null : position * 110;
});
const patterns: Readonly<Record<LoadingVariant, { readonly delays: readonly (number | null)[]; readonly duration: number; readonly round: boolean }>> = {
  Drive: { delays: chevron, duration: 650, round: false },
  Dots: { delays: chevron, duration: 650, round: true },
  Orbit: { delays: orbit, duration: 950, round: false }
};

function useElapsed(): string {
  const [deciseconds, setDeciseconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setDeciseconds((current) => current + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  const total = deciseconds / 10;
  return total < 60 ? `${total.toFixed(1)}s` : `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reducedMotion;
}

function useRotatingLabel(label: string, rotatingLabels: readonly string[] | undefined, rotationMs: number): string {
  const [index, setIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const rotationKey = rotatingLabels?.join("\u0000") ?? "";
  const labelCount = rotatingLabels?.length ?? 0;

  useEffect(() => {
    setIndex(0);
    if (reducedMotion || labelCount < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % labelCount), rotationMs);
    return () => window.clearInterval(timer);
  }, [labelCount, reducedMotion, rotationKey, rotationMs]);

  return labelCount > 0 ? rotatingLabels?.[index % labelCount] ?? label : label;
}

/** Pixel-grid feedback for blocking, long-running, and short inline asynchronous work. */
export function LoadingState({ label = "Working", variant = "Drive", className, rotatingLabels, labelRotationMs = 1_100 }: LoadingStateProps): React.JSX.Element {
  const elapsed = useElapsed();
  const visibleLabel = useRotatingLabel(label, rotatingLabels, labelRotationMs);
  const pattern = patterns[variant];
  return <div className={className ? `loading-state ${className}` : "loading-state"} role="status" aria-live="polite">
    <span className="loading-grid" aria-hidden="true">{pattern.delays.map((delay, index) => <span key={index} className={pattern.round ? "round" : ""} style={delay === null ? undefined : { animationDelay: `${delay}ms`, animationDuration: `${pattern.duration}ms` }} />)}</span>
    <span className="loading-label">{visibleLabel}</span>
    <span className="loading-elapsed">{elapsed}</span>
  </div>;
}
