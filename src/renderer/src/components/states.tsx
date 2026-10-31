import { AlertTriangle, FolderSearch, WifiOff } from "@renderer/components/icons";
import type { AppIcon } from "@renderer/components/icons";
import { LoadingIndicator } from "./LoadingIndicator";
import { Button } from "./primitives";

interface StateBlockProps {
  icon?: AppIcon;
  title: string;
  description: string;
  role?: "alert" | "status";
  actionLabel?: string;
  loading?: boolean;
  initial?: boolean;
  empty?: boolean;
  onAction?: () => void;
}

function StateBlock({
  actionLabel,
  description,
  icon: Icon,
  loading = false,
  initial = false,
  empty = false,
  onAction,
  role,
  title
}: StateBlockProps): JSX.Element {
  return (
    <div
      className="grid min-h-40 place-items-center px-5 py-6 text-center"
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
    >
      <div className="max-w-sm">
        {empty ? <LoadingIndicator size={100} illustration="empty" /> : loading ? <LoadingIndicator size={112} illustration={initial ? "initial" : undefined} /> : Icon ? <div className="mx-auto flex size-10 items-center justify-center rounded-hcbMd border border-border bg-surface-0 text-accent"><Icon aria-hidden="true" size={20} /></div> : null}
        <h3 className={`${loading || Icon ? "mt-3 " : ""}text-[var(--text-md)] font-semibold text-text-primary`}>{title}</h3>
        <p className="mt-1 text-[var(--text-sm)] text-text-muted">{description}</p>
        {actionLabel && onAction ? (
          <Button className="mt-4" onClick={onAction} size="sm" variant="secondary">
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function LoadingState({
  description = "Reading planner data.",
  title = "Loading"
}: {
  title?: string;
  description?: string;
} = {}): JSX.Element {
  return (
    <StateBlock
      description={description}
      icon={FolderSearch}
      loading
      initial={title !== "Refreshing"}
      role="status"
      title={title}
    />
  );
}

export function EmptyState({
  description,
  title,
  showIcon = true
}: {
  title: string;
  description: string;
  showIcon?: boolean;
}): JSX.Element {
  return <StateBlock description={description} empty={showIcon} title={title} />;
}

export function OfflineState({
  description = "Google sync is disconnected.",
  onRetry,
  title = "Offline"
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
} = {}): JSX.Element {
  return (
    <StateBlock
      actionLabel="Retry later"
      description={description}
      icon={WifiOff}
      onAction={onRetry}
      title={title}
    />
  );
}

export function ErrorState({
  actionLabel = "Retry",
  description = "The request did not complete. The app remains usable with cached state where available.",
  onRetry,
  title = "Something went wrong"
}: {
  title?: string;
  description?: string;
  actionLabel?: string;
  onRetry?: () => void;
} = {}): JSX.Element {
  return (
    <StateBlock
      actionLabel={actionLabel}
      description={description}
      icon={AlertTriangle}
      onAction={onRetry}
      role="alert"
      title={title}
    />
  );
}
