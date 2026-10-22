import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";

const motionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribeMotion = (notify: () => void) => {
  const query = motionQuery();
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

function Frame({ children, disabled }: { children: ReactNode; disabled: boolean }) {
  const present = useIsPresent();
  return <motion.div
    className="calendar-transition-frame"
    data-active={present}
    aria-hidden={!present || undefined}
    inert={!present}
    initial={disabled ? false : { opacity: 0, x: 16 }}
    animate={{ opacity: 1, x: 0 }}
    exit={disabled ? { opacity: 0 } : { opacity: 0, x: -12 }}
    transition={{ duration: disabled ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
  >{children}</motion.div>;
}

/** Keep the outgoing grid painted while the new timescale slides into place.
 * Only the current grid accepts input or appears in the accessibility tree. */
export function CalendarViewTransition({ viewKey, children, disabled }: { viewKey: string; children: ReactNode; disabled: boolean }) {
  const reduced = useSyncExternalStore(subscribeMotion, () => motionQuery().matches);
  return <div className="calendar-transition" data-motion={disabled || reduced ? "off" : "on"}>
    <AnimatePresence initial={false}>
      <Frame key={viewKey} disabled={disabled || Boolean(reduced)}>{children}</Frame>
    </AnimatePresence>
  </div>;
}
