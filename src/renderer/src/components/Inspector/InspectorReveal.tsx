import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function InspectorReveal({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion() || document.documentElement.dataset.animations === "disabled";
  return <AnimatePresence initial={false}>{open ? <motion.div className="inspector-reveal" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .2, ease: [.22, 1, .36, 1] }}><div className="grid min-w-0 gap-2">{children}</div></motion.div> : null}</AnimatePresence>;
}
