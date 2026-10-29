import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "@renderer/components/icons";
import { forwardRef, useRef, useImperativeHandle, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

type SelectProps = Omit<ComponentPropsWithoutRef<typeof Primitive.Trigger>, "value" | "defaultValue" | "children"> & {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  name?: string;
  required?: boolean;
};

// Prefix every value so an explicit empty choice (None/System/No parent) remains
// selectable. Radix reserves the empty string for its unselected placeholder.
const encode = (value: string | number) => `value:${value}`;

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, defaultValue, onValueChange, children, className, disabled, name, required, ...props }, ref
) {
  const trigger = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => trigger.current!);
  return (
    <Primitive.Root value={value === undefined ? undefined : encode(value)} defaultValue={defaultValue === undefined ? undefined : encode(defaultValue)} onValueChange={(next) => {
      onValueChange?.(next.slice(6));
      trigger.current?.dispatchEvent(new Event("hcb:field-commit", { bubbles: true }));
    }} disabled={disabled} name={name} required={required}>
      <Primitive.Trigger ref={trigger} {...props} data-value={value} className={cn("app-select-trigger", className)}>
        <Primitive.Value placeholder="Choose…" />
        <Primitive.Icon asChild><ChevronDown aria-hidden="true" size={14} /></Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content className="app-select-content" position="popper" sideOffset={5} collisionPadding={8} onEscapeKeyDown={(event) => event.stopPropagation()}>
          <Primitive.ScrollUpButton className="app-select-scroll"><ChevronUp size={14} /></Primitive.ScrollUpButton>
          <Primitive.Viewport className="app-select-viewport">{children}</Primitive.Viewport>
          <Primitive.ScrollDownButton className="app-select-scroll"><ChevronDown size={14} /></Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
});

export function SelectItem({ value, children, disabled }: { value: string | number; children: ReactNode; disabled?: boolean }) {
  return <Primitive.Item className="app-select-item" data-value={value} value={encode(value)} disabled={disabled}>
    <Primitive.ItemIndicator className="app-select-check"><Check size={14} /></Primitive.ItemIndicator>
    <Primitive.ItemText>{children}</Primitive.ItemText>
  </Primitive.Item>;
}
