import type { JSX as ReactJsx } from "react";

/**
 * React 19 no longer exports JSX through the global namespace. HCB has a
 * substantial existing surface annotated as JSX.Element, so keep that source
 * compatibility while new code uses React.JSX directly.
 */
declare global {
  namespace JSX {
    type Element = ReactJsx.Element;
  }
}

export {};
