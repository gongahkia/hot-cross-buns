import type {
  CalendarListSummary,
  GoogleStatusResponse,
  SettingsSnapshot,
  TaskListSummary
} from "@shared/ipc/contracts";
import { useState } from "react";
import { Eye, EyeOff, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { Badge, Button, IconButton, Input, cx } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import {
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch
} from "./SettingsPrimitives";

interface ProfileSettingsTabProps {
  beginGoogleOAuth: () => Promise<void>;
  calendarSources: CalendarListSummary[];
  disconnectGoogle: () => Promise<void>;
  googleClientId: string;
  googleClientSecret: string;
  googleStatus: GoogleStatusResponse;
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
  const connected = account?.connectionState === "connected";
  const accountLabel = account?.displayName || account?.email || (connected ? "Connected Google account" : "Not connected");
  const accountDetail = account?.email ?? account?.googleAccountId ?? account?.connectionState ?? "Google account is not connected";

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
        <div className="grid min-h-11 gap-2 border-b border-border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            {account?.avatarUrl ? (
              <img
                alt=""
                className="size-8 shrink-0 rounded-full border border-border bg-surface-0 object-cover"
                referrerPolicy="no-referrer"
                src={account.avatarUrl}
              />
            ) : (
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-0 text-text-muted">
                <Users aria-hidden="true" size={16} />
              </div>
            )}
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
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <Button
            disabled={!googleStatus.oauthClientConfigured}
            onClick={() => void beginGoogleOAuth()}
            variant="primary"
          >
            <Users aria-hidden="true" size={14} />
            Add Google Account
          </Button>
          <Button disabled={!account} onClick={() => void disconnectGoogle()} variant="secondary">
            Disconnect
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Task lists">
        {taskLists.length === 0 ? (
          <EmptyState description="No task lists are cached yet." title="No task lists" />
        ) : taskLists.map((taskList) => (
          <SettingsSwitch
            checked={selectedTaskLists.size === 0 || selectedTaskLists.has(taskList.id)}
            key={taskList.id}
            label={taskList.title}
            onChange={(checked) => updateSelectedTaskList(taskList.id, checked)}
            trailing={<Badge>{taskList.activeTaskCount ?? taskList.taskCount ?? 0}</Badge>}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Calendars">
        {calendarSources.length === 0 ? (
          <EmptyState description="No calendars are cached yet." title="No calendars" />
        ) : calendarSources.map((calendar) => (
          <SettingsSwitch
            checked={selectedCalendars.size === 0 ? calendar.selected : selectedCalendars.has(calendar.id)}
            description={calendar.timeZone ?? undefined}
            key={calendar.id}
            label={calendar.title}
            onChange={(checked) => updateSelectedCalendar(calendar.id, checked)}
            trailing={<Badge>{calendar.eventCount ?? 0}</Badge>}
          />
        ))}
      </SettingsGroup>
    </div>
  );
}
