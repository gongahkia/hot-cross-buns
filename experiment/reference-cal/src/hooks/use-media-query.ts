import * as React from "react";

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 *
 * Returns `false` during server rendering and hydration, then the live value.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = React.useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const getViewportWidth = () => window.innerWidth;
const getServerWidth = () => 1280;

export function useViewportWidth(): number {
  return React.useSyncExternalStore(
    subscribeViewport,
    getViewportWidth,
    getServerWidth,
  );
}
