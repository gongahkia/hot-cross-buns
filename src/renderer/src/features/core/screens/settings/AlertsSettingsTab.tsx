import type { SettingsSnapshot, SettingsUpdateRequest } from "@shared/ipc/contracts";
import { Bell, Download, Play, Volume2 } from "lucide-react";
import { Badge, Button } from "../../../../components/primitives";
import { playCompletionSound } from "../../completionSounds";
import { displayAccelerator } from "../../hotkeys";
import {
  SegmentedControl,
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch,
  settingsSelectClass
} from "./SettingsPrimitives";

interface AlertsSettingsTabProps {
  settings: SettingsSnapshot;
  updateSettings: (request: SettingsUpdateRequest) => void;
}

const soundOptions: Array<{ label: string; value: SettingsSnapshot["taskCompletionSoundId"] }> = [
  { label: "Glass", value: "glass" },
  { label: "Pop", value: "pop" },
  { label: "Chime", value: "chime" },
  { label: "Click", value: "click" }
];

export function AlertsSettingsTab({
  settings,
  updateSettings
}: AlertsSettingsTabProps): JSX.Element {
  async function enableNotifications(checked: boolean): Promise<void> {
    if (checked) {
      await window.hcb?.native.requestNotificationPermission();
    }

    updateSettings({ notificationsEnabled: checked });
  }

  return (
    <div className="grid gap-5">
      <SettingsGroup title="Notifications">
        <SettingsSwitch
          checked={settings.notificationsEnabled}
          icon={Bell}
          label="Local reminders"
          onChange={(checked) => void enableNotifications(checked)}
          trailing={<Badge>{settings.notificationLeadMinutes} min</Badge>}
        />
        <SettingsControlRow label="Reminder lead time">
          <input
            aria-label="Reminder lead time"
            className="w-56 accent-[var(--color-accent)]"
            max={240}
            min={0}
            onChange={(event) => updateSettings({ notificationLeadMinutes: Number(event.target.value) })}
            step={5}
            type="range"
            value={settings.notificationLeadMinutes}
          />
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="Completion sounds">
        <SettingsSwitch
          checked={settings.taskCompletionSoundEnabled}
          description="Played when a task is marked complete from any surface."
          icon={Volume2}
          label="Task completion"
          onChange={(checked) => updateSettings({ taskCompletionSoundEnabled: checked })}
        />
        <SettingsControlRow label="Task sound">
          <SoundPicker
            onPreview={() => playCompletionSound(settings.taskCompletionSoundId)}
            onChange={(value) => updateSettings({ taskCompletionSoundId: value })}
            value={settings.taskCompletionSoundId}
          />
        </SettingsControlRow>
        <SettingsSwitch
          checked={settings.eventCompletionSoundEnabled}
          description="Played when an event is marked done or dismissed from Calendar."
          icon={Volume2}
          label="Event completion"
          onChange={(checked) => updateSettings({ eventCompletionSoundEnabled: checked })}
        />
        <SettingsControlRow label="Event sound">
          <SoundPicker
            onPreview={() => playCompletionSound(settings.eventCompletionSoundId)}
            onChange={(value) => updateSettings({ eventCompletionSoundId: value })}
            value={settings.eventCompletionSoundId}
          />
        </SettingsControlRow>
        <SettingsControlRow
          description="Imported sounds are counted in settings; built-in preview tones remain available everywhere."
          label="Imported sounds"
        >
          <div className="flex items-center gap-2">
            <Button
              onClick={() => updateSettings({ importedSoundCount: settings.importedSoundCount + 1 })}
              variant="secondary"
            >
              <Download aria-hidden="true" size={14} />
              Import sound
            </Button>
            <Badge>{settings.importedSoundCount} imported</Badge>
          </div>
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="Menu bar">
        <SettingsSwitch
          checked={settings.showTrayIcon}
          label="Menu bar extra"
          onChange={(checked) => updateSettings({ showTrayIcon: checked })}
        />
        <SettingsControlRow label="Menu bar panel">
          <SegmentedControl
            onChange={(value) =>
              updateSettings({ menuBarPanelStyle: value as SettingsSnapshot["menuBarPanelStyle"] })
            }
            options={[
              { label: "Adaptive", value: "adaptive" },
              { label: "Calendar", value: "calendar" }
            ]}
            value={settings.menuBarPanelStyle}
          />
        </SettingsControlRow>
        <SettingsControlRow label="Menu bar icon">
          <select
            aria-label="Menu bar icon"
            className={settingsSelectClass}
            onChange={(event) =>
              updateSettings({ menuBarIconName: event.target.value as SettingsSnapshot["menuBarIconName"] })
            }
            value={settings.menuBarIconName}
          >
            <option value="pin">Pin</option>
            <option value="calendar">Calendar</option>
            <option value="bun">Bun</option>
            <option value="checklist">Checklist</option>
          </select>
        </SettingsControlRow>
        <SettingsSwitch
          checked={settings.showMenuBarBadge}
          label="Menu bar badge for overdue tasks"
          onChange={(checked) => updateSettings({ showMenuBarBadge: checked })}
        />
      </SettingsGroup>

      <SettingsGroup title="Dock">
        <SettingsSwitch
          checked={settings.showDockBadge}
          label="Dock badge for overdue tasks"
          onChange={(checked) => updateSettings({ showDockBadge: checked })}
        />
      </SettingsGroup>

      <SettingsGroup title="Global hotkey">
        <SettingsSwitch
          checked={settings.globalQuickAddHotkeyEnabled}
          label="Global quick-add hotkey"
          onChange={(checked) => updateSettings({ globalQuickAddHotkeyEnabled: checked })}
        />
        <SettingsControlRow
          description={settings.globalQuickAddHotkeyEnabled ? "Registered by the native shell when supported." : "The global quick-add hotkey is off."}
          label="Shortcut"
        >
          <Badge>{displayAccelerator(settings.keybindings["task.quickCapture"])}</Badge>
        </SettingsControlRow>
      </SettingsGroup>
    </div>
  );
}

function SoundPicker({
  onChange,
  onPreview,
  value
}: {
  onChange: (value: SettingsSnapshot["taskCompletionSoundId"]) => void;
  onPreview: () => void;
  value: SettingsSnapshot["taskCompletionSoundId"];
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Completion sound"
        className={settingsSelectClass}
        onChange={(event) => onChange(event.target.value as SettingsSnapshot["taskCompletionSoundId"])}
        value={value}
      >
        {soundOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Button onClick={onPreview} variant="ghost">
        <Play aria-hidden="true" size={14} />
        Preview
      </Button>
    </div>
  );
}
