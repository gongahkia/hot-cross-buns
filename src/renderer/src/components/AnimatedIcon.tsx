import { useContext, useSyncExternalStore } from "react";
import { AnimatePresence, motion, MotionConfigContext } from "motion/react";
import type { AppIcon } from "./icons";

let reducedMotionQuery: MediaQueryList | undefined;
const motionQuery = () => reducedMotionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
const getReducedMotion = () => motionQuery().matches;
const serverReducedMotion = () => true;
function subscribeMotionPreference(changed: () => void) {
  const query = motionQuery();
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

/** State changes only; navigation and decorative glyphs remain still. */
export function AnimatedIcon({ icon: Icon, state, size = 16, className, spin = false }: {
  icon: AppIcon;
  state: string | boolean;
  size?: number;
  className?: string;
  spin?: boolean;
}) {
  // The installed Motion hook snapshots this preference at mount. Subscribe
  // directly so changing the OS setting also cancels an in-progress icon swap.
  const reducedMotion = useSyncExternalStore(subscribeMotionPreference, getReducedMotion, serverReducedMotion);
  const config = useContext(MotionConfigContext);
  const still = reducedMotion || config.reducedMotion === "always";
  return <span aria-hidden="true" className={["hcb-icon-swap", className].filter(Boolean).join(" ")}
    style={{ width: size, height: size }}>
    {still ? <Icon size={size} /> : <AnimatePresence initial={false}>
      <motion.span key={String(state)} className="hcb-icon-swap-layer"
        initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
        transition={{ type: "spring", duration: 0.3, bounce: 0 }}>
        <Icon size={size} spin={spin} />
      </motion.span>
    </AnimatePresence>}
  </span>;
}
