'use client';

import * as React from 'react';
import { isMotionComponent, motion, type HTMLMotionProps } from 'motion/react';
import { cn } from '@renderer/lib/utils';

type AnyProps = Record<string, unknown>;

export type DOMMotionProps<T extends HTMLElement = HTMLElement> = Omit<HTMLMotionProps<keyof HTMLElementTagNameMap>, 'ref'> & {
  ref?: React.Ref<T>;
};

export type SlotProps<T extends HTMLElement = HTMLElement> = {
  children?: React.ReactElement;
} & DOMMotionProps<T>;

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return (node) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') ref(node);
      else (ref as React.RefObject<T | null>).current = node;
    });
  };
}

/** Animate UI's source-owned motion slot, adapted to HCB's renderer aliases. */
export function Slot<T extends HTMLElement = HTMLElement>({ children, ref, ...props }: SlotProps<T>): React.JSX.Element | null {
  if (!children || !React.isValidElement(children)) return null;

  const isAlreadyMotion = typeof children.type === 'object' && children.type !== null && isMotionComponent(children.type);
  const Base = React.useMemo(
    () => isAlreadyMotion ? children.type as React.ElementType : motion.create(children.type as React.ElementType),
    [children.type, isAlreadyMotion]
  );
  const { ref: childRef, ...childProps } = children.props as AnyProps;
  const className = cn(childProps.className as string, props.className);
  const style = { ...(childProps.style as React.CSSProperties), ...(props.style as React.CSSProperties) };

  return <Base {...childProps} {...props} className={className} style={style} ref={mergeRefs(childRef as React.Ref<T>, ref)} />;
}
