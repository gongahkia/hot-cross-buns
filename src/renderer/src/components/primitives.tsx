import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode
} from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Button as ShadcnButton, type ButtonProps } from "./ui/button";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return cn(classes);
}

export type { ButtonProps } from "./ui/button";
export const Button = ShadcnButton;

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  icon: LucideIcon;
  label: string;
}

export function IconButton({
  className,
  icon: Icon,
  label,
  title,
  ...props
}: IconButtonProps): JSX.Element {
  return (
    <Button
      aria-label={label}
      className={cx("size-10 px-0", className)}
      title={title ?? label}
      {...props}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={2} />
    </Button>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, id, ...props },
  ref
) {
  const input = (
    <input
      className={cx(
        "min-h-10 w-full rounded-hcbMd border border-border bg-surface-0 px-3 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-[background-color,border-color,color,box-shadow] duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className
      )}
      id={id}
      ref={ref}
      {...props}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary" htmlFor={id}>
      <span>{label}</span>
      {input}
    </label>
  );
});

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const badgeTones: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-0 text-text-secondary",
  accent: "border-accent bg-bg-secondary text-accent",
  success: "border-success bg-bg-secondary text-success",
  warning: "border-warning bg-bg-secondary text-warning",
  danger: "border-danger bg-bg-secondary text-danger",
  info: "border-info bg-bg-secondary text-info"
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps): JSX.Element {
  return (
    <span
      className={cx(
        "inline-flex h-5 max-w-full items-center rounded-full border px-2 text-[var(--text-xs)] font-medium leading-none",
        badgeTones[tone],
        className
      )}
      {...props}
    />
  );
}

type StatusTone = "info" | "success" | "warning" | "danger" | "offline";

export interface StatusBannerProps extends HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description: string;
  tone?: StatusTone;
  action?: ReactNode;
}

const statusTones: Record<StatusTone, string> = {
  info: "border-info text-info",
  success: "border-success text-success",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
  offline: "border-warning text-warning"
};

export function StatusBanner({
  action,
  className,
  description,
  icon: Icon,
  title,
  tone = "info",
  ...props
}: StatusBannerProps): JSX.Element {
  return (
    <div
      className={cx(
        "flex min-h-11 items-center gap-3 rounded-hcbMd border bg-bg-secondary px-3 py-2",
        statusTones[tone],
        className
      )}
      {...props}
    >
      {Icon ? (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-hcbSm bg-surface-0">
          <Icon aria-hidden="true" size={15} strokeWidth={2} />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[var(--text-sm)] font-semibold text-text-primary">{title}</div>
        <div className="truncate text-[var(--text-xs)] text-text-muted">{description}</div>
      </div>
      {action}
    </div>
  );
}

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function Panel({
  action,
  children,
  className,
  description,
  title,
  ...props
}: PanelProps): JSX.Element {
  return (
    <section
      className={cx("min-w-0 rounded-hcbMd border border-border bg-bg-secondary", className)}
      {...props}
    >
      {title ? (
        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h2 className="hcb-heading truncate text-[var(--text-md)] font-semibold text-text-primary">{title}</h2>
            {description ? (
              <p className="hcb-copy truncate text-[var(--text-xs)] text-text-muted">{description}</p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  leading?: ReactNode;
  title: string;
  description?: string;
  meta?: string;
  trailing?: ReactNode;
  selected?: boolean;
}

export function ListRow({
  className,
  description,
  leading,
  meta,
  selected = false,
  title,
  trailing,
  ...props
}: ListRowProps): JSX.Element {
  return (
    <div
      className={cx(
        "flex min-h-11 w-full flex-wrap items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 sm:flex-nowrap",
        selected ? "bg-surface-0" : "bg-transparent",
        className
      )}
      role="listitem"
      {...props}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[var(--text-md)] font-medium text-text-primary">{title}</span>
          {meta ? <span className="shrink-0 text-[var(--text-xs)] text-text-muted">{meta}</span> : null}
        </div>
        {description ? (
          <p className="truncate text-[var(--text-sm)] text-text-muted">{description}</p>
        ) : null}
      </div>
      {trailing}
    </div>
  );
}
