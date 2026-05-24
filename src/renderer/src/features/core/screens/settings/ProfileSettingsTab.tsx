import type {
  CalendarListSummary,
  GoogleStatusResponse,
  SettingsSnapshot,
  TaskListSummary
} from "@shared/ipc/contracts";
import { Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { Badge, Button, Input } from "../../../../components/primitives";
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
  const selectedTaskLists = new Set(settings.selectedTaskListIds);
  const selectedCalendars = new Set(settings.selectedCalendarIds);
  const account = googleStatus.account;
  const accountLabel = account?.displayName || account?.email || "Not connected";
  const accountDetail = account?.email ?? account?.connectionState ?? "Google account is not connected";

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
          <Input
            aria-label="Google OAuth client ID"
            onChange={(event) => setGoogleClientId(event.currentTarget.value)}
            placeholder="Client ID from Google Cloud Console"
            value={googleClientId}
          />
        </SettingsControlRow>
        <SettingsControlRow label="Client secret (optional)">
          <Input
            aria-label="Google OAuth client secret"
            onChange={(event) => setGoogleClientSecret(event.currentTarget.value)}
            placeholder={googleStatus.hasClientSecret ? "Stored in Keychain" : "Optional for Desktop clients"}
            type="password"
            value={googleClientSecret}
          />
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
        <SettingsControlRow
          description={accountDetail}
          icon={Users}
          label={accountLabel}
        >
          <Badge tone={account?.connectionState === "connected" ? "success" : "warning"}>
            {account?.connectionState === "connected" ? "Active" : "Disconnected"}
          </Badge>
        </SettingsControlRow>
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
