import { StatusBanner } from "../../components/primitives";
import {
  type DiagnosticsTab,
  HistoryTab,
  LogsTab,
  OverviewTab,
  SupportTab,
  SyncTab
} from "./DiagnosticsTabs";
import { useDiagnosticsOverlay } from "./useDiagnosticsOverlay";

const stayInSettings = () => {};

export function DiagnosticsSettingsPanel({ initialTab }: { initialTab: DiagnosticsTab }): JSX.Element {
  const {
    clearLogs,
    copyDiagnosticSummary,
    copyHistory,
    copyLogs,
    copyVisibleSyncIssues,
    copyVisibleLogs,
    exportBundle,
    filteredHistory,
    filteredLogs,
    historyEntries,
    historyError,
    historyQuery,
    logLevel,
    logQuery,
    logs,
    message,
    pendingMutationsError,
    pendingMutations,
    rebuildNotifications,
    refreshLogs,
    refreshSyncDiagnostics,
    revealLogsFolder,
    runRecovery,
    setHistoryQuery,
    setLogLevel,
    setLogQuery,
    source,
    summary,
    summaryError,
    tab,
    working
  } = useDiagnosticsOverlay(stayInSettings, initialTab, true);

  return (
    <div className="grid gap-3">
        {message ? (
          <StatusBanner
            className="mb-0"
            description={message.text}
            title={message.tone === "success" ? "Diagnostics action applied" : "Diagnostics notice"}
            tone={message.tone}
          />
        ) : null}

        <div className="min-w-0">
          {tab === "overview" ? (
            <OverviewTab source={source} summary={summary} />
          ) : null}
          {tab === "sync" ? (
            <SyncTab
              copyVisibleSyncIssues={copyVisibleSyncIssues}
              pendingMutationsError={pendingMutationsError}
              pendingMutations={pendingMutations}
              refresh={() => void refreshSyncDiagnostics()}
              source={source}
              summary={summary}
              summaryError={summaryError}
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
              historyError={historyError}
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
    </div>
  );
}
