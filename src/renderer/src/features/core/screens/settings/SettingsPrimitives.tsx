import { createContext, isValidElement, useContext, type ReactNode } from "react";

import { cx } from "../../../../components/primitives";

export const settingsSelectClass =
  "min-h-10 min-w-0 max-w-full rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

interface SettingsSearchContextValue {
  groupTitleMatches: boolean;
  query: string;
}

interface SearchableElementProps {
  "aria-label"?: unknown;
  children?: ReactNode;
  description?: unknown;
  label?: unknown;
  title?: unknown;
}

const SettingsSearchContext = createContext<SettingsSearchContextValue>({
  groupTitleMatches: false,
  query: ""
});

function normalizedSettingsSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function compactSettingsSearchText(value: string): string {
  return normalizedSettingsSearchText(value).replace(/[^a-z0-9]+/g, "");
}

function searchableValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function collectSearchableText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(collectSearchableText).join(" ");
  }

  if (isValidElement<SearchableElementProps>(node)) {
    return [
      searchableValue(node.props.label),
      searchableValue(node.props.description),
      searchableValue(node.props.title),
      searchableValue(node.props["aria-label"]),
      collectSearchableText(node.props.children)
    ]
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

export function settingsSearchMatches(text: string, query: string): boolean {
  const normalizedQuery = normalizedSettingsSearchText(query);

  if (!normalizedQuery) {
    return true;
  }

  const normalizedText = normalizedSettingsSearchText(text);

  if (normalizedText.includes(normalizedQuery)) {
    return true;
  }

  const compactQuery = compactSettingsSearchText(query);

  return compactQuery.length > 0 && compactSettingsSearchText(text).includes(compactQuery);
}

export function SettingsSearchProvider({
  children,
  query
}: {
  children: ReactNode;
  query: string;
}): JSX.Element {
  return (
    <SettingsSearchContext.Provider value={{ groupTitleMatches: false, query }}>
      {children}
    </SettingsSearchContext.Provider>
  );
}

export function SettingsTabButton({
  active,
  alertCount = 0,
  label,
  onClick
}: {
  active: boolean;
  alertCount?: number;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      aria-pressed={active}
      className={cx(
        "inline-flex min-h-10 shrink-0 items-center justify-start gap-2 rounded-hcbMd border px-2.5 text-[var(--text-base)] font-medium transition-[background-color,border-color,color] duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active
          ? "border-border bg-surface-0 text-text-primary"
          : "border-transparent text-text-muted hover:bg-surface-0 hover:text-text-primary"
      )}
      onClick={onClick}
      type="button"
    >
      <span className="truncate">{label}</span>
      {alertCount > 0 ? (
        <span
          aria-hidden="true"
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-bg-tertiary"
          title={`${alertCount} ${alertCount === 1 ? "issue" : "issues"}`}
        >
          {alertCount}
        </span>
      ) : null}
    </button>
  );
}

export function SettingsGroup({
  children,
  searchText = "",
  title
}: {
  children: ReactNode;
  searchText?: string;
  title: string;
}): JSX.Element | null {
  const search = useContext(SettingsSearchContext);
  const hasQuery = search.query.trim().length > 0;
  const groupTitleMatches = settingsSearchMatches(title, search.query);
  const groupContentMatches =
    groupTitleMatches || settingsSearchMatches(`${searchText} ${collectSearchableText(children)}`, search.query);

  if (hasQuery && !groupContentMatches) {
    return null;
  }

  return (
    <SettingsSearchContext.Provider value={{ groupTitleMatches, query: search.query }}>
      <section className="grid gap-1.5">
        <h3 className="hcb-heading px-1 text-[var(--text-md)] font-semibold text-text-primary">{title}</h3>
        <div className="overflow-hidden rounded-hcbMd border border-border bg-bg-secondary">
          {children}
        </div>
      </section>
    </SettingsSearchContext.Provider>
  );
}

export function SettingsControlRow({
  children,
  description,
  label
}: {
  children?: ReactNode;
  description?: string;
  label: string;
}): JSX.Element | null {
  const search = useContext(SettingsSearchContext);
  const hasQuery = search.query.trim().length > 0;
  const rowMatches = settingsSearchMatches(`${label} ${description ?? ""} ${collectSearchableText(children)}`, search.query);

  if (hasQuery && !search.groupTitleMatches && !rowMatches) {
    return null;
  }

  return (
    <div className="settings-control-row grid min-h-11 gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="min-w-0">
          <div className="text-pretty text-[var(--text-base)] font-medium text-text-primary">{label}</div>
          {description ? (
            <p className="hcb-copy mt-0.5 text-[var(--text-sm)] text-text-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="settings-control-value flex min-w-0 max-w-full items-center justify-start">{children}</div>
      ) : null}
    </div>
  );
}

export function SettingsSwitch({
  checked,
  description,
  label,
  onChange,
  trailing
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (checked: boolean) => void;
  trailing?: ReactNode;
}): JSX.Element | null {
  return (
    <SettingsControlRow description={description} label={label}>
      <div className="flex max-w-full flex-wrap items-center gap-3">
        {trailing}
        <label className="settings-switch relative flex h-10 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            aria-label={label}
            checked={checked}
            className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
            onChange={(event) => onChange(event.target.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-switch-track relative h-6 w-10 rounded-full bg-surface-2 transition-colors peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
            <span className="settings-switch-thumb absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform" />
          </span>
        </label>
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
  options: Array<{ label: string; value: string }>;
  value: string;
}): JSX.Element {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-hcbMd border border-border bg-surface-0 p-1">
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            aria-pressed={active}
            className={cx(
              "inline-flex min-h-10 min-w-20 items-center justify-center gap-2 rounded-hcbSm px-3 text-[var(--text-sm)] font-semibold transition-[background-color,color] duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active ? "bg-accent text-[var(--color-accent-foreground)]" : "text-text-secondary hover:bg-surface-1 hover:text-text-primary"
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
