import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from "react";
import { SPINNERS } from "loading-dev";
import { cx } from "./primitives";

export const loadingIndicatorVariants = [
  "arc",
  "atom",
  "blocks",
  "bouncing-dots",
  "cascade",
  "circular-dots",
  "classic",
  "classic-v2",
  "clock",
  "comet",
  "compass",
  "dual",
  "eclipse",
  "flip",
  "gather",
  "leap",
  "linear-dots",
  "loading",
  "morph",
  "orbit",
  "pulse",
  "radar",
  "ring",
  "ripple",
  "slide",
  "snake",
  "swirl",
  "trace",
  "wave"
] as const;

export const loadingIndicatorSurfaces = [
  {
    description: "Initial planner data and refresh states across Tasks, Calendar, and Notes.",
    id: "general",
    label: "Planner data and refreshes"
  },
  {
    description: "Searches that fall through from commands to local planner results.",
    id: "search",
    label: "Command palette search"
  },
  {
    description: "Mermaid diagrams while their renderer module and SVG are being prepared.",
    id: "preview",
    label: "Diagram previews"
  }
] as const;

export type LoadingIndicatorVariant = (typeof loadingIndicatorVariants)[number];
export type LoadingIndicatorSurface = (typeof loadingIndicatorSurfaces)[number]["id"];
export type LoadingIndicatorPreferences = Record<LoadingIndicatorSurface, LoadingIndicatorVariant>;

export const defaultLoadingIndicatorPreferences: LoadingIndicatorPreferences = {
  general: "blocks",
  preview: "blocks",
  search: "blocks"
};

interface LoadingIndicatorContextValue {
  animationsDisabled: boolean;
  preferences: LoadingIndicatorPreferences;
}

const LoadingIndicatorContext = createContext<LoadingIndicatorContextValue>({
  animationsDisabled: false,
  preferences: defaultLoadingIndicatorPreferences
});

const variantSet = new Set<string>(loadingIndicatorVariants);

interface LoadingDevSpinnerProps {
  className?: string;
  color?: string;
  duration?: number;
  playState?: "paused" | "running";
  size?: number;
}

function isLoadingIndicatorVariant(value: unknown): value is LoadingIndicatorVariant {
  return typeof value === "string" && variantSet.has(value);
}

export function resolveLoadingIndicatorPreferences(value: unknown): LoadingIndicatorPreferences {
  const stored = value && typeof value === "object"
    ? value as Partial<Record<LoadingIndicatorSurface, unknown>>
    : {};

  return {
    general: isLoadingIndicatorVariant(stored.general) ? stored.general : "blocks",
    preview: isLoadingIndicatorVariant(stored.preview) ? stored.preview : "blocks",
    search: isLoadingIndicatorVariant(stored.search) ? stored.search : "blocks"
  };
}

export function LoadingIndicatorProvider({
  animationsDisabled,
  children,
  preferences
}: {
  animationsDisabled: boolean;
  children: ReactNode;
  preferences: unknown;
}): JSX.Element {
  const value = useMemo<LoadingIndicatorContextValue>(() => ({
    animationsDisabled,
    preferences: resolveLoadingIndicatorPreferences(preferences)
  }), [animationsDisabled, preferences]);

  return <LoadingIndicatorContext.Provider value={value}>{children}</LoadingIndicatorContext.Provider>;
}

export function useLoadingIndicatorPreferences(): LoadingIndicatorContextValue {
  return useContext(LoadingIndicatorContext);
}

export function LoadingIndicator({
  className,
  size = 20,
  surface = "general"
}: {
  className?: string;
  size?: number;
  surface?: LoadingIndicatorSurface;
}): JSX.Element {
  const { animationsDisabled, preferences } = useLoadingIndicatorPreferences();
  const variant = preferences[surface];
  const Spinner = (SPINNERS[variant] ?? SPINNERS.blocks) as ComponentType<LoadingDevSpinnerProps>;

  return (
    <Spinner
      className={cx("shrink-0", className)}
      playState={animationsDisabled ? "paused" : "running"}
      size={size}
    />
  );
}

export function loadingIndicatorLabel(variant: LoadingIndicatorVariant): string {
  return variant
    .split("-")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}
