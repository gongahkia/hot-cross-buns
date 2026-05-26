import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  DiagnosticsHistoryEntry,
  DiagnosticsLogEntry,
  DiagnosticsLogLevel,
  DiagnosticsLogsResponse,
  DiagnosticsPendingMutation,
  DiagnosticsSummaryResponse
} from "@shared/ipc/contracts";
import {
  ClipboardCopy,
  DatabaseZap,
  FileText,
  Folder,
  Gauge,
  History,
  LifeBuoy,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, Button, IconButton, Input, StatusBanner, cx } from "../../components/primitives";
import { useCoreViewModelSource, type CoreViewModelSource } from "./coreViewModelSource";

type DiagnosticsTab = "overview" | "sync" | "logs" | "history" | "support";

interface DiagnosticsOverlayProps {
  onClose: () => void;
}

const tabs: Array<{ id: DiagnosticsTab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "sync", label: "Sync", icon: RefreshCw },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "history", label: "History", icon: History },
  { id: "support", label: "Support", icon: LifeBuoy }
];

const logLevels: DiagnosticsLogLevel[] = ["debug", "info", "warn", "error"];

export function DiagnosticsOverlay({ onClose }: DiagnosticsOverlayProps): JSX.Element {
  const source = useCoreViewModelSource();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<DiagnosticsTab>("overview");
  const [summary, setSummary] = useState<DiagnosticsSummaryResponse | null>(
    source.diagnosticsSummary ?? null
  );
  const [logs, setLogs] = useState<DiagnosticsLogsResponse | null>(null);
  const [historyEntries, setHistoryEntries] = useState<DiagnosticsHistoryEntry[]>([]);
  const [pendingMutations, setPendingMutations] = useState<DiagnosticsPendingMutation[]>([]);
  const [logLevel, setLogLevel] = useState<DiagnosticsLogLevel>("info");
  const [logQuery, setLogQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
    void refreshAll();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    void refreshLogs();
  }, [logLevel]);

  const filteredLogs = useMemo(() => {
    const query = logQuery.trim().toLowerCase();
    const entries = logs?.entries ?? [];

    if (!query) {
      return entries;
    }

    return entries.filter((entry) =>
      [entry.timestamp, entry.level, entry.category, entry.message, entry.metadataLine ?? ""]
        .join("\n")
        .toLowerCase()
        .includes(query)
    );
  }, [logQuery, logs?.entries]);

  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();

    if (!query) {
      return historyEntries;
    }

    return historyEntries.filter((entry) =>
      [entry.timestamp, entry.kind, entry.summary, entry.metadataLine ?? ""]
        .join("\n")
        .toLowerCase()
        .includes(query)
    );
  }, [historyEntries, historyQuery]);

  async function refreshAll(): Promise<void> {
    await Promise.all([refreshSummary(), refreshLogs(), refreshHistory(), refreshPendingMutations()]);
  }

  async function refreshSummary(): Promise<void> {
    const result = await window.hcb?.diagnostics.summary();

    if (result?.ok) {
      setSummary(result.data);
    }
  }

  async function refreshLogs(): Promise<void> {
    const result = await window.hcb?.diagnostics.logs({ minimumLevel: logLevel, limit: 200 });

    if (result?.ok) {
      setLogs(result.data);
    }
  }

  async function refreshHistory(): Promise<void> {
    const result = await window.hcb?.diagnostics.history({ limit: source.settings.visibleHistoryEntryCount });

    if (result?.ok) {
      setHistoryEntries(result.data.entries);
    }
  }

  async function refreshPendingMutations(): Promise<void> {
    const result = await window.hcb?.diagnostics.pendingMutations({ limit: 100 });

    if (result?.ok) {
      setPendingMutations(result.data.mutations);
    }
  }

  async function runRecovery(
    action: "refresh" | "forceFullResync" | "clearGoogleCache"
  ): Promise<void> {
    if (
      action === "forceFullResync" &&
      !window.confirm("Force a full Google resync by clearing sync checkpoints?")
    ) {
      return;
    }

    if (
      action === "clearGoogleCache" &&
      !window.confirm("Clear cached Google task and calendar data from this Mac?")
    ) {
      return;
    }

    setWorking(true);
    setMessage(null);

    const result = await source.runRecoveryAction({
      action,
      ...(action === "forceFullResync"
        ? { confirmation: { accepted: true, phrase: "FULL RESYNC" } }
        : {}),
      ...(action === "clearGoogleCache"
        ? { confirmation: { accepted: true, phrase: "CLEAR CACHE" } }
        : {})
    });

    setWorking(false);

    if (result) {
      setMessage({ tone: "success", text: result.message });
      await refreshAll();
    }
  }

  async function rebuildNotifications(): Promise<void> {
    setWorking(true);
    setMessage(null);
    const result = await window.hcb?.diagnostics.rescheduleNotifications();
    setWorking(false);

    if (result?.ok) {
      setMessage({ tone: "success", text: result.data.message });
      await refreshSummary();
      return;
    }

    if (result && !result.ok) {
      setMessage({ tone: "warning", text: result.error.message });
    }
  }

  async function retryMutation(id: string): Promise<void> {
    const result = await window.hcb?.diagnostics.retryPendingMutation({ id });

    if (result?.ok) {
      setMessage({ tone: "success", text: "Pending mutation was queued for retry." });
      await Promise.all([refreshPendingMutations(), refreshHistory(), refreshSummary()]);
    }
  }

  async function cancelMutation(id: string): Promise<void> {
    if (!window.confirm("Cancel this pending Google write?")) {
      return;
    }

    const result = await window.hcb?.diagnostics.cancelPendingMutation({ id });

    if (result?.ok) {
      setMessage({ tone: "success", text: "Pending mutation was cancelled." });
      await Promise.all([refreshPendingMutations(), refreshHistory(), refreshSummary()]);
    }
  }

  async function clearLogs(): Promise<void> {
    if (!window.confirm("Clear all local diagnostics logs?")) {
      return;
    }

    const result = await window.hcb?.diagnostics.clearLogs();

    if (result?.ok) {
      setMessage({ tone: "success", text: "Logs cleared." });
      await refreshLogs();
    }
  }

  async function revealLogsFolder(): Promise<void> {
    const result = await window.hcb?.diagnostics.revealLogsFolder();

    if (result?.ok) {
      setMessage({
        tone: result.data.opened ? "success" : "warning",
        text: result.data.message
      });
    }
  }

  async function copyDiagnosticSummary(): Promise<void> {
    const result = await window.hcb?.diagnostics.copyableSummary();

    if (result?.ok) {
      await navigator.clipboard?.writeText(result.data.text);
      setMessage({ tone: "success", text: "Diagnostic summary copied." });
    }
  }

  async function exportBundle(): Promise<void> {
    const result = await window.hcb?.diagnostics.exportBundle();

    if (result?.ok) {
      setMessage({
        tone: result.data.exported ? "success" : "warning",
        text: result.data.message
      });
    }
  }

  async function copyLogs(): Promise<void> {
    const text =
      logs?.persistedText ||
      (logs?.entries ?? []).map((entry) => entry.formattedLine).join("\n");

    await navigator.clipboard?.writeText(text);
    setMessage({ tone: "success", text: "All logs copied." });
  }

  async function copyVisibleLogs(): Promise<void> {
    const text = filteredLogs.map((entry) => entry.formattedLine).join("\n");

    await navigator.clipboard?.writeText(text);
    setMessage({ tone: "success", text: "Visible logs copied." });
  }

  async function copyHistory(): Promise<void> {
    const text = filteredHistory
      .map((entry) => `${formatDateTime(entry.timestamp)} [${entry.kind}] ${entry.summary}`)
      .join("\n");

    await navigator.clipboard?.writeText(text);
    setMessage({ tone: "success", text: "Visible history copied." });
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-bg-tertiary/45 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="diagnostics-overlay-title"
        aria-modal="true"
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-primary shadow-2xl sm:max-h-[calc(100dvh-72px)]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-bg-primary px-3 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-hcbSm bg-surface-0 text-accent">
              <Gauge aria-hidden="true" size={14} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[var(--text-md)] font-semibold text-text-primary" id="diagnostics-overlay-title">
                Diagnostics
              </h2>
              <p className="truncate text-[var(--text-xs)] text-text-muted">
                Runtime state, logs, sync queue, and support bundle
              </p>
            </div>
          </div>
          <IconButton icon={X} label="Close diagnostics" onClick={onClose} variant="ghost" />
        </header>

        <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border bg-bg-primary px-3 py-2">
          {tabs.map((entry) => {
            const Icon = entry.icon;
            const selected = tab === entry.id;

            return (
              <button
                aria-pressed={selected}
                className={cx(
                  "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-hcbMd border px-2.5 text-[var(--text-base)] font-medium transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  selected
                    ? "border-border bg-surface-0 text-text-primary"
                    : "border-transparent text-text-muted hover:bg-surface-0 hover:text-text-primary"
                )}
                key={entry.id}
                onClick={() => setTab(entry.id)}
                type="button"
              >
                <Icon aria-hidden="true" className="shrink-0" size={14} strokeWidth={2} />
                <span className="truncate">{entry.label}</span>
              </button>
            );
          })}
        </div>

        {message ? (
          <StatusBanner
            className="m-3 mb-0"
            description={message.text}
            title={message.tone === "success" ? "Diagnostics action applied" : "Diagnostics notice"}
            tone={message.tone}
          />
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {tab === "overview" ? (
            <OverviewTab source={source} summary={summary} />
          ) : null}
          {tab === "sync" ? (
            <SyncTab
              pendingMutations={pendingMutations}
              refresh={() => void Promise.all([refreshPendingMutations(), refreshSummary()])}
              retryMutation={retryMutation}
              cancelMutation={cancelMutation}
              rebuildNotifications={rebuildNotifications}
              runRecovery={runRecovery}
              working={working}
            />
          ) : null}
          {tab === "logs" ? (
            <LogsTab
              clearLogs={clearLogs}
              copyLogs={copyLogs}
              copyVisibleLogs={copyVisibleLogs}
              filteredLogs={filteredLogs}
              logLevel={logLevel}
              logQuery={logQuery}
              logs={logs}
              refreshLogs={() => void refreshLogs()}
              revealLogsFolder={revealLogsFolder}
              setLogLevel={setLogLevel}
              setLogQuery={setLogQuery}
            />
          ) : null}
          {tab === "history" ? (
            <HistoryTab
              copyHistory={copyHistory}
              filteredHistory={filteredHistory}
              historyEntries={historyEntries}
              historyQuery={historyQuery}
              setHistoryQuery={setHistoryQuery}
            />
          ) : null}
          {tab === "support" ? (
            <SupportTab
              copyDiagnosticSummary={copyDiagnosticSummary}
              exportBundle={exportBundle}
              summary={summary}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function OverviewTab({
  source,
  summary
}: {
  source: CoreViewModelSource;
  summary: DiagnosticsSummaryResponse | null;
}): JSX.Element {
  const googleLabel =
    source.googleStatus.account?.displayName ??
    source.googleStatus.account?.email ??
    summary?.account.state ??
    "Unknown";
  const credentialStatus = summary?.native.capabilities.find((item) => item.key === "credentialStorage");

  return (
    <div className="grid gap-3">
      <DiagnosticSection title="Status">
        <DiagnosticRow label="Google" value={googleLabel} />
        <DiagnosticRow label="Sync" value={summary?.sync.state ?? source.syncStatus.state} />
        <DiagnosticRow label="Mode" value={source.settings.syncMode} />
        <DiagnosticRow label="Last sync" value={formatDateTime(summary?.sync.lastCompletedAt)} />
        <DiagnosticRow label="Keychain" value={credentialStatus?.state ?? "unknown"} />
      </DiagnosticSection>

      {summary?.performance ? (
        <DiagnosticSection title="Performance">
          <DiagnosticRow label="Last sync" value={durationText(summary.performance.lastSyncDurationMs)} />
          <DiagnosticRow label="Migration" value={durationText(summary.performance.migrationDurationMs)} />
          <DiagnosticRow
            label="Slow queries"
            value={`${summary.performance.slowQuerySamples.length} sample${summary.performance.slowQuerySamples.length === 1 ? "" : "s"}`}
          />
          <DiagnosticRow
            label="MCP requests"
            value={String(summary.performance.mcpRequestCounts.totalRequests)}
          />
        </DiagnosticSection>
      ) : null}

      <DiagnosticSection title="Local data">
        <DiagnosticRow label="Task lists" value={String(summary?.cache.taskListCount ?? source.taskLists.length)} />
        <DiagnosticRow label="Tasks" value={String(summary?.cache.taskCount ?? source.largeTaskWindow.length)} />
        <DiagnosticRow label="Calendars" value={String(summary?.cache.calendarCount ?? source.calendarSources.length)} />
        <DiagnosticRow label="Events" value={String(summary?.cache.eventCount ?? source.calendarAgendaEvents.length)} />
        <DiagnosticRow label="Sync checkpoints" value={String(summary?.checkpoints.totalCount ?? 0)} />
        <DiagnosticRow label="Pending writes" value={String(summary?.pendingMutations.totalCount ?? source.syncStatus.pendingMutationCount)} />
      </DiagnosticSection>

      <DiagnosticSection title="Selections">
        <DiagnosticRow
          label="Selected task lists"
          value={selectionText(summary?.selectedResources.taskLists, source.taskLists.length)}
        />
        <DiagnosticRow
          label="Selected calendars"
          value={selectionText(summary?.selectedResources.calendars, source.calendarSources.length)}
        />
        <DiagnosticRow label="Local reminders" value={source.settings.notificationsEnabled ? "Enabled" : "Disabled"} />
        <DiagnosticRow label="Onboarding" value={source.settings.setupCompletedAt ? "Completed" : "Not completed"} />
      </DiagnosticSection>

      <DiagnosticSection title="Cache">
        <DiagnosticRow
          label="Database"
          value={summary?.native.paths.find((path) => path.role === "data")?.redactedPath ?? "Unavailable"}
          mono
        />
      </DiagnosticSection>
    </div>
  );
}

function SyncTab({
  pendingMutations,
  refresh,
  retryMutation,
  cancelMutation,
  rebuildNotifications,
  runRecovery,
  working
}: {
  pendingMutations: DiagnosticsPendingMutation[];
  refresh: () => void;
  retryMutation: (id: string) => Promise<void>;
  cancelMutation: (id: string) => Promise<void>;
  rebuildNotifications: () => Promise<void>;
  runRecovery: (action: "refresh" | "forceFullResync" | "clearGoogleCache") => Promise<void>;
  working: boolean;
}): JSX.Element {
  return (
    <div className="grid gap-3">
      <DiagnosticSection title="Recovery">
        <div className="flex flex-wrap gap-2 p-3">
          <Button disabled={working} onClick={() => void runRecovery("refresh")}>
            <RefreshCw aria-hidden="true" size={15} />
            Refresh now
          </Button>
          <Button disabled={working} onClick={() => void runRecovery("forceFullResync")}>
            <RotateCcw aria-hidden="true" size={15} />
            Force full resync
          </Button>
          <Button disabled={working} onClick={() => void rebuildNotifications()}>
            <Search aria-hidden="true" size={15} />
            Rebuild local reminders
          </Button>
          <Button disabled={working} onClick={() => void runRecovery("clearGoogleCache")} variant="danger">
            <DatabaseZap aria-hidden="true" size={15} />
            Clear cached Google data
          </Button>
          <Button onClick={refresh} variant="ghost">
            <RefreshCw aria-hidden="true" size={15} />
            Refresh diagnostics
          </Button>
        </div>
      </DiagnosticSection>

      <DiagnosticSection
        title="Pending sync queue"
        trailing={<Badge tone={pendingMutations.length > 0 ? "warning" : "neutral"}>{pendingMutations.length}</Badge>}
      >
        {pendingMutations.length === 0 ? (
          <p className="px-3 py-4 text-[var(--text-sm)] text-text-muted">No pending Google writes.</p>
        ) : (
          <div className="grid">
            {pendingMutations.map((mutation) => (
              <div className="flex min-h-11 items-start gap-3 border-b border-border px-3 py-2 last:border-b-0" key={mutation.id}>
                <Badge tone={mutation.status === "failed" ? "danger" : mutation.status === "applying" ? "info" : "neutral"}>
                  {mutation.status}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--text-sm)] font-semibold">{operationLabel(mutation.operation)}</div>
                  <div className="truncate font-mono text-[var(--text-xs)] text-text-muted">
                    {mutation.resourceType} · {formatDateTime(mutation.createdAt)} · {mutation.attemptCount} attempts
                  </div>
                  {mutation.lastErrorMessage ? (
                    <div className="text-[var(--text-xs)] text-danger">{mutation.lastErrorMessage}</div>
                  ) : null}
                </div>
                {mutation.status === "failed" ? (
                  <IconButton icon={RefreshCw} label="Retry pending mutation" onClick={() => void retryMutation(mutation.id)} variant="ghost" />
                ) : null}
                <IconButton icon={X} label="Cancel pending mutation" onClick={() => void cancelMutation(mutation.id)} variant="ghost" />
              </div>
            ))}
          </div>
        )}
      </DiagnosticSection>
    </div>
  );
}

function LogsTab({
  clearLogs,
  copyLogs,
  copyVisibleLogs,
  filteredLogs,
  logLevel,
  logQuery,
  logs,
  refreshLogs,
  revealLogsFolder,
  setLogLevel,
  setLogQuery
}: {
  clearLogs: () => Promise<void>;
  copyLogs: () => Promise<void>;
  copyVisibleLogs: () => Promise<void>;
  filteredLogs: DiagnosticsLogEntry[];
  logLevel: DiagnosticsLogLevel;
  logQuery: string;
  logs: DiagnosticsLogsResponse | null;
  refreshLogs: () => void;
  revealLogsFolder: () => Promise<void>;
  setLogLevel: (level: DiagnosticsLogLevel) => void;
  setLogQuery: (query: string) => void;
}): JSX.Element {
  return (
    <div className="grid min-h-[55vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-hcbMd border border-border bg-bg-secondary">
      <div className="grid gap-2 border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--text-sm)] font-semibold">Level</span>
          <div className="flex overflow-hidden rounded-hcbMd border border-border bg-surface-0">
            {logLevels.map((level) => (
              <button
                className={cx(
                  "h-7 px-2.5 text-[var(--text-sm)] font-semibold transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  logLevel === level ? "bg-accent text-bg-tertiary" : "text-text-secondary hover:bg-surface-1"
                )}
                key={level}
                onClick={() => setLogLevel(level)}
                type="button"
              >
                {level[0].toUpperCase()}{level.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Button disabled={filteredLogs.length === 0} onClick={() => void copyVisibleLogs()}>
            <ClipboardCopy aria-hidden="true" size={15} />
            Copy visible
          </Button>
          <Button disabled={(logs?.entries.length ?? 0) === 0} onClick={() => void copyLogs()}>
            <ClipboardCopy aria-hidden="true" size={15} />
            Copy all
          </Button>
          <Button onClick={refreshLogs}>
            <RefreshCw aria-hidden="true" size={15} />
            Refresh
          </Button>
        </div>
        <SearchInput label="Search logs" value={logQuery} onChange={setLogQuery} />
      </div>

      <div className="min-h-0 overflow-auto bg-bg-secondary">
        {filteredLogs.length === 0 ? (
          <p className="p-4 text-[var(--text-sm)] text-text-muted">No log entries match this view.</p>
        ) : (
          filteredLogs.map((entry) => <LogRow entry={entry} key={entry.id} />)
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <span className="text-[var(--text-sm)] text-text-muted">
          {filteredLogs.length} of {logs?.entries.length ?? 0} shown
        </span>
        <div className="flex-1" />
        <Button disabled={(logs?.entries.length ?? 0) === 0} onClick={() => void copyLogs()}>
          <ClipboardCopy aria-hidden="true" size={15} />
          Copy all logs
        </Button>
        <Button onClick={() => void revealLogsFolder()}>
          <Folder aria-hidden="true" size={15} />
          Reveal logs folder
        </Button>
        <Button onClick={() => void clearLogs()} variant="danger">
          <Trash2 aria-hidden="true" size={15} />
          Clear logs
        </Button>
      </div>
    </div>
  );
}

function HistoryTab({
  copyHistory,
  filteredHistory,
  historyEntries,
  historyQuery,
  setHistoryQuery
}: {
  copyHistory: () => Promise<void>;
  filteredHistory: DiagnosticsHistoryEntry[];
  historyEntries: DiagnosticsHistoryEntry[];
  historyQuery: string;
  setHistoryQuery: (query: string) => void;
}): JSX.Element {
  return (
    <div className="grid min-h-[55vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-hcbMd border border-border bg-bg-secondary">
      <div className="grid gap-2 border-b border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[var(--text-md)] font-semibold">Mutation history</h3>
          <span className="text-[var(--text-sm)] text-text-muted">{historyEntries.length} retained</span>
        </div>
        <SearchInput label="Search history" value={historyQuery} onChange={setHistoryQuery} />
      </div>
      <div className="min-h-0 overflow-auto">
        {filteredHistory.length === 0 ? (
          <p className="p-4 text-[var(--text-sm)] text-text-muted">No history entries match this view.</p>
        ) : (
          filteredHistory.map((entry) => <HistoryRow entry={entry} key={entry.id} />)
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <span className="text-[var(--text-sm)] text-text-muted">
          {filteredHistory.length} of {historyEntries.length} shown
        </span>
        <div className="flex-1" />
        <Button disabled={filteredHistory.length === 0} onClick={() => void copyHistory()}>
          <ClipboardCopy aria-hidden="true" size={15} />
          Copy visible history
        </Button>
      </div>
    </div>
  );
}

function SupportTab({
  copyDiagnosticSummary,
  exportBundle,
  summary
}: {
  copyDiagnosticSummary: () => Promise<void>;
  exportBundle: () => Promise<void>;
  summary: DiagnosticsSummaryResponse | null;
}): JSX.Element {
  return (
    <div className="grid gap-3">
      <DiagnosticSection title="Support">
        <div className="flex flex-wrap gap-2 p-3">
          <Button onClick={() => void copyDiagnosticSummary()}>
            <ClipboardCopy aria-hidden="true" size={15} />
            Copy diagnostic summary
          </Button>
          <Button onClick={() => void exportBundle()}>
            <Folder aria-hidden="true" size={15} />
            Export diagnostic bundle...
          </Button>
        </div>
      </DiagnosticSection>
      <DiagnosticSection title="Redaction">
        <DiagnosticRow label="Credentials" value={summary?.redaction.credentials ?? "redacted"} />
        <DiagnosticRow label="Google payloads" value={summary?.redaction.googlePayloads ?? "omitted"} />
        <DiagnosticRow label="MCP bearer tokens" value={summary?.redaction.mcpBearerTokens ?? "redacted"} />
        <DiagnosticRow label="Sensitive bodies" value={summary?.redaction.sensitiveBodies ?? "omitted"} />
      </DiagnosticSection>
    </div>
  );
}

function DiagnosticSection({
  children,
  title,
  trailing
}: {
  children: ReactNode;
  title: string;
  trailing?: React.ReactNode;
}): JSX.Element {
  return (
    <section className="overflow-hidden rounded-hcbMd border border-border bg-bg-secondary">
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h3 className="text-[var(--text-md)] font-semibold text-text-primary">{title}</h3>
        {trailing}
      </div>
      <div>{children}</div>
    </section>
  );
}

function DiagnosticRow({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 border-b border-border px-3 py-1.5 last:border-b-0">
      <span className="min-w-0 truncate text-[var(--text-sm)] font-medium text-text-muted">{label}</span>
      <span className={cx("min-w-0 truncate text-right text-[var(--text-sm)] font-medium text-text-primary", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}

function SearchInput({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}): JSX.Element {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        size={15}
      />
      <Input
        aria-label={label}
        className="pl-9"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={label}
        value={value}
      />
    </div>
  );
}

function LogRow({ entry }: { entry: DiagnosticsLogEntry }): JSX.Element {
  return (
    <div className="flex gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <Badge tone={entry.level === "error" ? "danger" : entry.level === "warn" ? "warning" : "info"}>
        {entry.level}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[var(--text-sm)]">
          [{entry.category}] {entry.message}
        </div>
        <div className="truncate font-mono text-[var(--text-xs)] text-text-muted">
          {formatTime(entry.timestamp)} {entry.metadataLine ?? ""}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: DiagnosticsHistoryEntry }): JSX.Element {
  return (
    <div className="flex gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <Badge tone={entry.kind.includes("delete") || entry.kind.includes("cancel") ? "danger" : "success"}>
        {entry.kind.split(".")[0]}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[var(--text-sm)]">{entry.summary}</div>
        <div className="truncate font-mono text-[var(--text-xs)] text-text-muted">
          {entry.kind} · {formatDateTime(entry.timestamp)} {entry.metadataLine ?? ""}
        </div>
      </div>
    </div>
  );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "medium"
  }).format(date);
}

function durationText(value: number | undefined): string {
  return value === undefined ? "No sample yet" : `${Math.round(value * 10) / 10} ms`;
}

function selectionText(
  selections: Array<{ selected: boolean }> | undefined,
  fallbackTotal: number
): string {
  if (!selections || selections.length === 0) {
    return fallbackTotal === 0 ? "Not loaded" : `0 of ${fallbackTotal}`;
  }

  return `${selections.filter((selection) => selection.selected).length} of ${selections.length}`;
}

function operationLabel(operation: string): string {
  return operation
    .split(".")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
