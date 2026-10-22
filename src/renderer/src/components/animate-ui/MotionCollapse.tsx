import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * A small Animate UI/Motion primitive for disclosure content. It deliberately
 * avoids layout animation on the always-visible list rows, which keeps dense
 * task boards responsive and honors HCB's global reduced-motion CSS rule.
 */
export function MotionCollapse({ children, open }: { children: ReactNode; open: boolean }): React.JSX.Element {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
