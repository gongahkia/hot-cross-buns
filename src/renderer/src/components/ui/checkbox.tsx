import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

/** Source-owned accessible checkbox for new controls and incremental migrations. */
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>): React.JSX.Element {
  return (
    <CheckboxPrimitive.Root
      className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-text-muted text-[var(--color-accent-foreground)] data-[state=checked]:border-accent data-[state=checked]:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check aria-hidden="true" size={12} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
