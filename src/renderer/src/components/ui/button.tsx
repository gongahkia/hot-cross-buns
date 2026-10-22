import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-hcbMd border font-medium leading-none transition-[background-color,border-color,color,box-shadow,transform] duration-fast ease-hcb disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    defaultVariants: { size: "md", variant: "secondary" },
    variants: {
      variant: {
        primary: "border-accent bg-accent text-[var(--color-accent-foreground)] hover:bg-info hover:border-info",
        secondary: "border-border bg-surface-0 text-text-primary hover:bg-surface-1",
        ghost: "border-transparent bg-transparent text-text-secondary hover:bg-surface-0 hover:text-text-primary",
        danger: "border-danger bg-transparent text-danger ring-1 ring-danger/70 hover:bg-surface-0 hover:ring-danger"
      },
      size: {
        sm: "min-h-10 px-3 text-[var(--text-sm)]",
        md: "min-h-10 px-3 text-[var(--text-base)]"
      }
    }
  }
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Use for controls whose visual position must remain fixed while pressed. */
  static?: boolean;
}

/** Source-owned shadcn-style button adapted to HCB semantic theme tokens. */
export function Button({
  asChild = false,
  className,
  size,
  static: isStatic = false,
  type = "button",
  variant,
  ...props
}: ButtonProps): React.JSX.Element {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ size, variant }), !isStatic && "active:scale-[0.96] motion-reduce:transform-none", className)}
      type={type}
      {...props}
    />
  );
}
