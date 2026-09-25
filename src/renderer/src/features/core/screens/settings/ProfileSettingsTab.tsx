import type {
  CalendarListSummary,
  GoogleStatusResponse,
  SettingsSnapshot,
  TaskListSummary
} from "@shared/ipc/contracts";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Mail, Paperclip, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { Badge, Button, IconButton, Input, cx } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import {
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch
} from "./SettingsPrimitives";

interface ProfileSettingsTabProps {
  beginGoogleOAuth: (requestedServices?: Array<"drive" | "gmail">) => Promise<void>;
  calendarSources: CalendarListSummary[];
  disconnectGoogle: (accountId?: string) => Promise<void>;
  googleClientId: string;
  googleClientSecret: string;
  googleStatus: GoogleStatusResponse;
  refreshPlanner: () => void;
  saveGoogleOAuthClient: () => Promise<void>;
  setGoogleClientId: (value: string) => void;
  setGoogleClientSecret: (value: string) => void;
  settings: SettingsSnapshot;
  settingsMutationPending: boolean;
  taskLists: TaskListSummary[];
  updateSelectedCalendar: (calendarId: string, selected: boolean) => void;
  updateSelectedTaskList: (taskListId: string, selected: boolean) => void;
}

export function ProfileSettingsTab({
  beginGoogleOAuth,
  calendarSources,
  disconnectGoogle,
  googleClientId,
  googleClientSecret,
  googleStatus,
  refreshPlanner,
  saveGoogleOAuthClient,
  setGoogleClientId,
  setGoogleClientSecret,
  settings,
  settingsMutationPending,
  taskLists,
  updateSelectedCalendar,
  updateSelectedTaskList
}: ProfileSettingsTabProps): JSX.Element {
  const [showClientSecret, setShowClientSecret] = useState(false);
  const selectedTaskLists = new Set(settings.selectedTaskListIds);
  const selectedCalendars = new Set(settings.selectedCalendarIds);
  const account = googleStatus.account;
  const accounts = googleStatus.accounts.length > 0 ? googleStatus.accounts : account ? [account] : [];
  const visibleAccounts = accounts.filter(isVisibleGoogleAccount);
  const primaryAccount = visibleAccounts[0] ?? (account && isVisibleGoogleAccount(account) ? account : undefined);
  const [resourceAccountFilter, setResourceAccountFilter] = useState("all");
  const visibleTaskLists = resourceAccountFilter === "all"
    ? taskLists
    : taskLists.filter((taskList) => taskList.accountId === resourceAccountFilter);
  const visibleCalendarSources = resourceAccountFilter === "all"
    ? calendarSources
    : calendarSources.filter((calendar) => calendar.accountId === resourceAccountFilter);
  const connected = primaryAccount?.connectionState === "connected";
  const accountLabel = primaryAccount?.displayName || primaryAccount?.email || (connected ? "Connected Google account" : "Not connected");
  const accountDetail = primaryAccount?.email ?? primaryAccount?.googleAccountId ?? primaryAccount?.connectionState ?? "Google account is not connected";

  useEffect(() => {
    if (resourceAccountFilter === "all" || visibleAccounts.some((candidate) => candidate.accountId === resourceAccountFilter)) {
      return;
    }

    setResourceAccountFilter("all");
  }, [resourceAccountFilter, visibleAccounts]);

  return (
    <div className="grid gap-5">
      <SettingsGroup title="Google OAuth client">
        <SettingsControlRow
          description={googleStatus.oauthClientConfigured ? "Google Cloud OAuth client saved." : "Missing"}
          icon={ShieldCheck}
          label="Google Cloud OAuth client"
        >
          <Badge tone={googleStatus.oauthClientConfigured ? "success" : "warning"}>
            {googleStatus.oauthClientConfigured ? "Configured" : "Missing"}
          </Badge>
        </SettingsControlRow>
        <SettingsControlRow label="Desktop OAuth client ID">
          <div className="w-full max-w-full sm:w-[42rem]">
            <Input
              aria-label="Google OAuth client ID"
              onChange={(event) => setGoogleClientId(event.currentTarget.value)}
              placeholder="Client ID from Google Cloud Console"
              value={googleClientId}
            />
          </div>
        </SettingsControlRow>
        <SettingsControlRow label="Client secret (optional)">
          <div className="flex w-full max-w-full items-center gap-2 sm:w-[42rem]">
            <Input
              aria-label="Google OAuth client secret"
              onChange={(event) => setGoogleClientSecret(event.currentTarget.value)}
              placeholder={googleStatus.hasClientSecret ? "Stored in Keychain" : "Optional for Desktop clients"}
              type={showClientSecret ? "text" : "password"}
              value={googleClientSecret}
            />
            <IconButton
              icon={showClientSecret ? EyeOff : Eye}
              label={showClientSecret ? "Hide client secret" : "Show client secret"}
              onClick={() => setShowClientSecret((current) => !current)}
              variant="secondary"
            />
          </div>
        </SettingsControlRow>
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <Button
            disabled={googleClientId.trim().length < 10 || settingsMutationPending}
            onClick={() => void saveGoogleOAuthClient()}
            variant="primary"
          >
            <Save aria-hidden="true" size={14} />
            Save OAuth Client
          </Button>
          <Button onClick={() => setGoogleClientSecret("")} variant="secondary">
            <Trash2 aria-hidden="true" size={14} />
            Clear
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Google accounts">
        {visibleAccounts.length > 0 ? (
          visibleAccounts.map((candidate) => {
            const candidateConnected = candidate.connectionState === "connected";
            const candidateLabel = candidate.displayName || candidate.email || "Google account";
            const candidateDetail = candidate.email ?? candidate.googleAccountId ?? candidate.connectionState;

            return (
              <div className="grid min-h-11 gap-2 border-b border-border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={candidate.accountId}>
                <div className="flex min-w-0 items-center gap-2.5">
                  {candidate.avatarUrl ? (
                    <img
                      alt=""
                      className="size-8 shrink-0 rounded-full border border-border bg-surface-0 object-cover"
                      referrerPolicy="no-referrer"
                      src={candidate.avatarUrl}
                    />
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-0 text-text-muted">
                      <Users aria-hidden="true" size={16} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[var(--text-base)] font-medium text-text-primary">{candidateLabel}</div>
                    <p className={cx(
                      "mt-0.5 truncate text-[var(--text-sm)]",
                      candidateConnected ? "text-text-muted" : "text-warning"
                    )}>
                      {candidateDetail}
                    </p>
                    {candidateConnected ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone="neutral">Calendar + Tasks</Badge>
                        {candidate.grantedScopes?.includes("https://www.googleapis.com/auth/drive.metadata.readonly") ? <Badge tone="neutral">Drive metadata</Badge> : null}
                        {candidate.grantedScopes?.includes("https://www.googleapis.com/auth/gmail.readonly") ? <Badge tone="neutral">Gmail read-only</Badge> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Badge tone={candidateConnected ? "success" : "warning"}>
                    {candidateConnected ? "Active" : candidate.connectionState}
                  </Badge>
                  <Button onClick={() => void disconnectGoogle(candidate.accountId)} size="sm" variant="secondary">
                    Disconnect
                  </Button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="grid min-h-11 gap-2 border-b border-border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-0 text-text-muted">
                <Users aria-hidden="true" size={16} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[var(--text-base)] font-medium text-text-primary">{accountLabel}</div>
                <p className={cx(
                  "mt-0.5 truncate text-[var(--text-sm)]",
                  connected ? "text-text-muted" : "text-warning"
                )}>
                  {accountDetail}
                </p>
              </div>
            </div>
            <Badge tone={connected ? "success" : "warning"}>
              {connected ? "Active" : "Disconnected"}
            </Badge>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <Button
            disabled={!googleStatus.oauthClientConfigured}
            onClick={() => void beginGoogleOAuth()}
            variant="primary"
          >
            <Users aria-hidden="true" size={14} />
            Add Google Account
          </Button>
          <Button
            disabled={visibleAccounts.length === 0}
            onClick={() => void Promise.all(visibleAccounts.map((candidate) => disconnectGoogle(candidate.accountId)))}
            variant="secondary"
          >
            Disconnect all
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Optional Google Workspace access">
        <div className="grid gap-1 px-3 pt-3 text-[var(--text-sm)] text-text-secondary">
          <p>These are separate read-only scopes. They are requested only when you choose them; Drive file content and Gmail messages are never modified by HCB.</p>
          <p className="text-[var(--text-xs)] text-text-muted">Reconnecting preserves the existing Calendar and Tasks grants for the selected Google account.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-2">
          <Button disabled={!googleStatus.oauthClientConfigured} onClick={() => void beginGoogleOAuth(["drive"])} variant="secondary"><Paperclip aria-hidden="true" size={14} />Enable Drive attachments</Button>
          <Button disabled={!googleStatus.oauthClientConfigured} onClick={() => void beginGoogleOAuth(["gmail"])} variant="secondary"><Mail aria-hidden="true" size={14} />Enable Gmail capture</Button>
          <Button disabled={!googleStatus.oauthClientConfigured} onClick={() => void beginGoogleOAuth(["drive", "gmail"])} variant="secondary"><Users aria-hidden="true" size={14} />Enable both</Button>
        </div>
      </SettingsGroup>

      {visibleAccounts.some((candidate) => candidate.connectionState === "connected") ? <GmailCapture accounts={visibleAccounts.filter((candidate) => candidate.connectionState === "connected")} onCaptured={refreshPlanner} taskLists={taskLists} /> : null}

      {visibleAccounts.filter((candidate) => candidate.connectionState === "connected").length >= 2 ? (
        <CrossAccountCopy accounts={visibleAccounts.filter((candidate) => candidate.connectionState === "connected")} calendarSources={calendarSources} />
      ) : null}

      <SettingsGroup title="Task lists">
        {visibleAccounts.length > 1 ? (
          <ResourceAccountFilter
            accounts={visibleAccounts}
            value={resourceAccountFilter}
            onChange={setResourceAccountFilter}
          />
        ) : null}
        {visibleTaskLists.length === 0 ? (
          <EmptyState description="No task lists are available yet." title="No task lists" />
        ) : visibleTaskLists.map((taskList) => (
          <SettingsSwitch
            checked={selectedTaskLists.size === 0 || selectedTaskLists.has(taskList.id)}
            key={taskList.id}
            label={taskList.title}
            onChange={(checked) => updateSelectedTaskList(taskList.id, checked)}
            trailing={(
              <span className="flex items-center gap-2">
                {visibleAccounts.length > 1 && taskList.accountId ? <Badge tone="neutral">{accountName(visibleAccounts, taskList.accountId)}</Badge> : null}
                <Badge>{taskList.activeTaskCount ?? taskList.taskCount ?? 0}</Badge>
              </span>
            )}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Calendars">
        {visibleAccounts.length > 1 ? (
          <ResourceAccountFilter
            accounts={visibleAccounts}
            value={resourceAccountFilter}
            onChange={setResourceAccountFilter}
          />
        ) : null}
        {visibleCalendarSources.length === 0 ? (
          <EmptyState description="No calendars are available yet." title="No calendars" />
        ) : visibleCalendarSources.map((calendar) => (
          <SettingsSwitch
            checked={selectedCalendars.size === 0 ? calendar.selected : selectedCalendars.has(calendar.id)}
            description={calendar.timeZone ?? undefined}
            key={calendar.id}
            label={calendar.title}
            onChange={(checked) => updateSelectedCalendar(calendar.id, checked)}
            trailing={(
              <span className="flex items-center gap-2">
                {visibleAccounts.length > 1 && calendar.accountId ? <Badge tone="neutral">{accountName(visibleAccounts, calendar.accountId)}</Badge> : null}
                <Badge>{calendar.eventCount ?? 0}</Badge>
              </span>
            )}
          />
        ))}
      </SettingsGroup>
    </div>
  );
}

function GmailCapture({
  accounts,
  onCaptured,
  taskLists
}: {
  accounts: GoogleStatusResponse["accounts"];
  onCaptured: () => void;
  taskLists: TaskListSummary[];
}): JSX.Element {
  const [accountId, setAccountId] = useState(accounts[0]?.accountId ?? "");
  const accountTaskLists = taskLists.filter((list) => list.accountId === accountId);
  const [listId, setListId] = useState(accountTaskLists[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Array<{ id: string; threadId?: string | null; subject: string; from?: string | null; snippet?: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const next = taskLists.find((list) => list.accountId === accountId)?.id ?? "";
    if (!accountTaskLists.some((list) => list.id === listId)) setListId(next);
  }, [accountId, accountTaskLists, listId, taskLists]);

  async function search(): Promise<void> {
    setMessage("Searching Gmail…");
    const result = await window.hcb?.google.searchGmailMessages({ accountId, query });
    if (!result?.ok) {
      setItems([]);
      setMessage(result?.error.message ?? "Gmail search failed. Enable Gmail capture first.");
      return;
    }
    setItems(result.data.items ?? []);
    setMessage(result.data.items?.length ? null : "No matching messages.");
  }

  async function capture(item: typeof items[number]): Promise<void> {
    const result = await window.hcb?.google.captureGmailMessage({ accountId, listId, messageId: item.id, threadId: item.threadId, subject: item.subject, from: item.from, snippet: item.snippet });
    if (!result?.ok) {
      setMessage(result?.error.message ?? "Could not create the Task.");
      return;
    }
    setMessage(`Created Task: ${result.data.title}`);
    onCaptured();
  }

  return (
    <SettingsGroup title="Gmail capture">
      <div className="grid gap-3 px-3 py-3">
        <p className="text-[var(--text-sm)] text-text-secondary">Searches message metadata and snippets, then creates a Google Task with a Gmail link. HCB does not alter mail.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>Google account</span><select aria-label="Gmail account" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" onChange={(event) => setAccountId(event.target.value)} value={accountId}>{accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.displayName || account.email || "Google account"}</option>)}</select></label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>Task list</span><select aria-label="Gmail capture task list" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" disabled={accountTaskLists.length === 0} onChange={(event) => setListId(event.target.value)} value={listId}>{accountTaskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>
        </div>
        <div className="flex gap-2"><Input aria-label="Search Gmail messages" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="from:person@example.com or project" value={query} /><Button aria-label="Search Gmail" disabled={!accountId} onClick={() => void search()} size="sm" type="button" variant="secondary"><Mail aria-hidden="true" size={14} /></Button></div>
        {items.length ? <div className="grid gap-1 rounded-hcbMd border border-border bg-surface-0 p-1">{items.map((item) => <div className="grid gap-1 rounded-hcbSm px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={item.id}><div className="min-w-0"><p className="truncate text-[var(--text-sm)] font-medium text-text-primary">{item.subject}</p><p className="truncate text-[var(--text-xs)] text-text-muted">{[item.from, item.snippet].filter(Boolean).join(" · ")}</p></div><Button disabled={!listId} onClick={() => void capture(item)} size="sm" type="button" variant="secondary">Create Task</Button></div>)}</div> : null}
        {message ? <p className="text-[var(--text-xs)] text-text-muted" role="status">{message}</p> : null}
      </div>
    </SettingsGroup>
  );
}

function CrossAccountCopy({
  accounts,
  calendarSources
}: {
  accounts: GoogleStatusResponse["accounts"];
  calendarSources: CalendarListSummary[];
}): JSX.Element {
  const [sourceAccountId, setSourceAccountId] = useState(accounts[0]?.accountId ?? "");
  const [destinationAccountId, setDestinationAccountId] = useState(accounts[1]?.accountId ?? accounts[0]?.accountId ?? "");
  const destinationCalendars = calendarSources.filter((calendar) => calendar.accountId === destinationAccountId);
  const [destinationCalendarId, setDestinationCalendarId] = useState(destinationCalendars[0]?.id ?? "");
  const [preview, setPreview] = useState<{ taskLists: number; tasks: number; events: number; skippedStatusEvents: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (sourceAccountId === destinationAccountId) {
      setDestinationAccountId(accounts.find((account) => account.accountId !== sourceAccountId)?.accountId ?? "");
    }
  }, [accounts, destinationAccountId, sourceAccountId]);

  useEffect(() => {
    const first = calendarSources.find((calendar) => calendar.accountId === destinationAccountId)?.id ?? "";
    if (!destinationCalendars.some((calendar) => calendar.id === destinationCalendarId)) setDestinationCalendarId(first);
  }, [calendarSources, destinationAccountId, destinationCalendarId, destinationCalendars]);

  async function refreshPreview(): Promise<void> {
    setMessage(null);
    const result = await window.hcb?.google.previewAccountCopy({ sourceAccountId, destinationAccountId, destinationCalendarId });
    if (!result?.ok) {
      setPreview(null);
      setMessage(result?.error.message ?? "Could not prepare the copy.");
      return;
    }
    setPreview(result.data);
  }

  async function copy(): Promise<void> {
    if (!window.confirm("Copy the shown Tasks and Calendar events into the destination account? The source will not be changed.")) return;
    const result = await window.hcb?.google.copyAccountData({ sourceAccountId, destinationAccountId, destinationCalendarId, confirmation: "COPY" });
    if (!result?.ok) {
      setMessage(result?.error.message ?? "Cross-account copy failed.");
      return;
    }
    setMessage(result.data.message);
    setPreview(result.data);
  }

  return (
    <SettingsGroup title="Cross-account copy">
      <div className="grid gap-3 px-3 pt-3">
        <p className="text-[var(--text-sm)] text-text-secondary">Creates independent copies in a second connected account. It never deletes or alters the source; copied events exclude guests, Meet links, Drive attachments, and Calendar status events.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>From</span><select aria-label="Copy source account" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" onChange={(event) => setSourceAccountId(event.target.value)} value={sourceAccountId}>{accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.displayName || account.email || "Google account"}</option>)}</select></label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>To account</span><select aria-label="Copy destination account" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" onChange={(event) => setDestinationAccountId(event.target.value)} value={destinationAccountId}>{accounts.filter((account) => account.accountId !== sourceAccountId).map((account) => <option key={account.accountId} value={account.accountId}>{account.displayName || account.email || "Google account"}</option>)}</select></label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary"><span>Event destination</span><select aria-label="Copy destination calendar" className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary" onChange={(event) => setDestinationCalendarId(event.target.value)} value={destinationCalendarId}>{destinationCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.title}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-2"><Button disabled={!sourceAccountId || !destinationAccountId || !destinationCalendarId || sourceAccountId === destinationAccountId} onClick={() => void refreshPreview()} size="sm" type="button" variant="secondary">Preview copy</Button>{preview ? <Button onClick={() => void copy()} size="sm" type="button" variant="primary">Copy {preview.tasks} tasks and {preview.events} events</Button> : null}</div>
        {preview ? <p className="text-[var(--text-xs)] text-text-muted">{preview.taskLists} task lists · {preview.tasks} tasks · {preview.events} events{preview.skippedStatusEvents ? ` · ${preview.skippedStatusEvents} status event(s) skipped` : ""}</p> : null}
        {message ? <p className="text-[var(--text-xs)] text-text-muted" role="status">{message}</p> : null}
      </div>
    </SettingsGroup>
  );
}

function isVisibleGoogleAccount(account: GoogleStatusResponse["accounts"][number]): boolean {
  if (account.connectionState === "signed_out") {
    return false;
  }

  if (account.accountId === "local-google-account" || account.accountId === "local:ics") {
    return false;
  }

  return Boolean(account.email || account.googleAccountId || account.connectionState === "connected");
}

function accountName(
  accounts: GoogleStatusResponse["accounts"],
  accountId: string
): string {
  const account = accounts.find((candidate) => candidate.accountId === accountId);
  return account?.displayName || account?.email || "Account";
}

function ResourceAccountFilter({
  accounts,
  onChange,
  value
}: {
  accounts: GoogleStatusResponse["accounts"];
  onChange: (value: string) => void;
  value: string;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <Button
        onClick={() => onChange("all")}
        size="sm"
        variant={value === "all" ? "primary" : "secondary"}
      >
        All accounts
      </Button>
      {accounts.map((account) => (
        <Button
          key={account.accountId}
          onClick={() => onChange(account.accountId)}
          size="sm"
          variant={value === account.accountId ? "primary" : "secondary"}
        >
          {accountName(accounts, account.accountId)}
        </Button>
      ))}
    </div>
  );
}
