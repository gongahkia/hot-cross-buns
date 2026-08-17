import { useEffect, useState } from "react";

export type LoadingVariant = "Drive" | "Dots" | "Orbit";

interface LoadingStateProps {
  readonly label?: string;
  readonly variant?: LoadingVariant;
  readonly className?: string;
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

/** Pixel-grid feedback for blocking, long-running, and short inline asynchronous work. */
export function LoadingState({ label = "Working", variant = "Drive", className }: LoadingStateProps): React.JSX.Element {
  const elapsed = useElapsed();
  const pattern = patterns[variant];
  return <div className={className ? `loading-state ${className}` : "loading-state"} role="status" aria-live="polite">
    <span className="loading-grid" aria-hidden="true">{pattern.delays.map((delay, index) => <span key={index} className={pattern.round ? "round" : ""} style={delay === null ? undefined : { animationDelay: `${delay}ms`, animationDuration: `${pattern.duration}ms` }} />)}</span>
    <span className="loading-label">{label}</span>
    <span className="loading-elapsed">{elapsed}</span>
  </div>;
}
