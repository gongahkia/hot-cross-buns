import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../../../../components/primitives";

export const settingsSelectClass =
  "h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function SettingsTabButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      aria-pressed={active}
      className={cx(
        "grid min-h-20 min-w-24 place-items-center gap-1 rounded-hcbLg border px-4 py-2 text-center transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active
          ? "border-border bg-surface-0 text-accent"
          : "border-transparent text-text-muted hover:bg-surface-0 hover:text-text-primary"
      )}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={30} strokeWidth={2} />
      <span className="text-[var(--text-sm)] font-semibold">{label}</span>
    </button>
  );
}

export function SettingsGroup({
  children,
  title
}: {
  children: ReactNode;
  title: string;
}): JSX.Element {
  return (
    <section className="grid gap-2">
      <h2 className="px-3 text-[var(--text-lg)] font-bold text-text-primary">{title}</h2>
      <div className="overflow-hidden rounded-hcbLg border border-border bg-bg-secondary">
        {children}
      </div>
    </section>
  );
}

export function SettingsControlRow({
  children,
  description,
  icon: Icon,
  label
}: {
  children?: ReactNode;
  description?: string;
  icon?: LucideIcon;
  label: string;
}): JSX.Element {
  return (
    <div className="grid min-h-14 gap-2 border-b border-border px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <Icon aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted" size={18} />
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-[var(--text-md)] font-semibold text-text-primary">{label}</div>
          {description ? (
            <p className="mt-1 text-[var(--text-sm)] text-text-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="flex min-w-0 items-center justify-start sm:justify-end">{children}</div>
      ) : null}
    </div>
  );
}

export function SettingsSwitch({
  checked,
  description,
  icon,
  label,
  onChange,
  trailing
}: {
  checked: boolean;
  description?: string;
  icon?: LucideIcon;
  label: string;
  onChange: (checked: boolean) => void;
  trailing?: ReactNode;
}): JSX.Element {
  return (
    <SettingsControlRow description={description} icon={icon} label={label}>
      <div className="flex items-center gap-3">
        {trailing}
        <input
          aria-label={label}
          checked={checked}
          className="h-5 w-9 accent-[var(--color-accent)]"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </div>
    </SettingsControlRow>
  );
}

export function SegmentedControl({
  onChange,
  options,
  value
}: {
  onChange: (value: string) => void;
  options: Array<{ icon?: LucideIcon; label: string; value: string }>;
  value: string;
}): JSX.Element {
  return (
    <div className="inline-flex max-w-full overflow-hidden rounded-hcbMd border border-border bg-surface-0 p-1">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;

        return (
          <button
            aria-pressed={active}
            className={cx(
              "inline-flex h-7 min-w-20 items-center justify-center gap-2 rounded-hcbSm px-3 text-[var(--text-sm)] font-semibold transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active ? "bg-accent text-bg-tertiary" : "text-text-secondary hover:bg-surface-1 hover:text-text-primary"
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {Icon ? <Icon aria-hidden="true" size={14} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
