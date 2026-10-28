import { Select, SelectItem } from "@renderer/components/Select";
import type { SettingsSnapshot, SettingsUpdateRequest } from "@shared/ipc/contracts";
import { useState } from "react";
import { Bell, Download, Play, Volume2 } from "lucide-react";
import { Badge, Button, cx } from "../../../../components/primitives";
import { playCompletionSound } from "../../completionSounds";
import {
  SegmentedControl,
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch,
  settingsSelectClass
} from "./SettingsPrimitives";

interface AlertsSettingsTabProps {
  browserRuntime?: boolean;
  notificationsAvailable?: boolean;
  settings: SettingsSnapshot;
  updateSettings: (request: SettingsUpdateRequest) => void;
}

const soundOptions: Array<{ label: string; value: SettingsSnapshot["taskCompletionSoundId"] }> = [
  { label: "Glass", value: "glass" },
  { label: "Pop", value: "pop" },
  { label: "Chime", value: "chime" },
  { label: "Click", value: "click" },
  { label: "Ding", value: "ding" },
  { label: "Pluck", value: "pluck" },
  { label: "Tick", value: "tick" },
  { label: "Sparkle", value: "sparkle" },
  { label: "Success", value: "success" },
  { label: "Soft bell", value: "softBell" },
  { label: "Arcade", value: "arcade" },
  { label: "Wood", value: "wood" },
  { label: "Coin", value: "coin" },
  { label: "Rise", value: "rise" },
  { label: "Pulse", value: "pulse" }
];

export function AlertsSettingsTab({
  settings,
  updateSettings,
  browserRuntime = false,
  notificationsAvailable = true
}: AlertsSettingsTabProps): JSX.Element {
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [customIconOpen, setCustomIconOpen] = useState(false);
  const [customIconName, setCustomIconName] = useState("");
  const [customIconDataBase64, setCustomIconDataBase64] = useState("");
  const [customIconPreviewUrl, setCustomIconPreviewUrl] = useState("");
  const [customIconFileName, setCustomIconFileName] = useState("");
  const [customIconError, setCustomIconError] = useState<string | null>(null);

  async function enableNotifications(checked: boolean): Promise<void> {
    if (checked) {
      const result = await window.hcb?.native.requestNotificationPermission();
      if (browserRuntime && (!result?.ok || result.data.permission !== "granted")) {
        setNotificationMessage(result && !result.ok ? result.error.message : result?.data.message ?? "Allow notifications in your browser's site settings, then try again.");
        return;
      }
    }

    setNotificationMessage(null);
    updateSettings({ notificationsEnabled: checked });
  }

  async function saveCustomIcon(): Promise<void> {
    const name = customIconName.trim();
    if (!name || !customIconDataBase64) {
      setCustomIconError("Enter a name and choose a PNG.");
      return;
    }

    const imported = await window.hcb?.native.importMenuBarIcon({
      name,
      dataBase64: customIconDataBase64
    });
    if (!imported?.ok) {
      setCustomIconError(imported?.error.message ?? "Could not import menu bar icon.");
      return;
    }

    updateSettings({
      customMenuBarIcons: [...settings.customMenuBarIcons, imported.data],
      menuBarCalendarIconId: imported.data.id
    });
    setCustomIconOpen(false);
    setCustomIconName("");
    setCustomIconDataBase64("");
    setCustomIconPreviewUrl("");
    setCustomIconFileName("");
    setCustomIconError(null);
  }

  async function selectCustomIconFile(file: File | null): Promise<void> {
    if (!file) {
      return;
    }

    if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
      setCustomIconError("Choose a PNG file.");
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const dataBase64 = bytesToBase64(bytes);
    setCustomIconDataBase64(dataBase64);
    setCustomIconPreviewUrl(`data:image/png;base64,${dataBase64}`);
    setCustomIconFileName(file.name);
    setCustomIconError(null);
  }

  return (
    <div className="grid gap-5">
      <SettingsGroup title="Notifications">
        {notificationsAvailable ? <SettingsSwitch
          checked={settings.notificationsEnabled}
          icon={Bell}
          label="Local reminders"
          description={browserRuntime ? "Reminders work while this app is open. Browsers may delay background tabs; reminders cannot run after the app closes. Task due dates use local midnight." : "While HCB is running, prepare up to 40 reminders for the next 24 hours. Task due dates use local midnight; the lead time below applies to Calendar events."}
          onChange={(checked) => void enableNotifications(checked)}
          trailing={<Badge>{settings.notificationLeadMinutes} min</Badge>}
        /> : <p className="px-3 py-3 text-sm text-text-secondary">Notifications are unavailable in this browser. Your planner remains available without reminders.</p>}
        {notificationMessage ? <p role="alert" className="px-3 text-sm text-danger">{notificationMessage}</p> : null}
        <SettingsControlRow label="Calendar reminder lead time">
          <input
            aria-label="Calendar reminder lead time"
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
        {!browserRuntime ? <SettingsControlRow
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
        </SettingsControlRow> : <p className="px-3 pb-3 text-sm text-text-muted">Built-in sounds play in the browser. Importing custom sound files is not available.</p>}
      </SettingsGroup>

      {!browserRuntime ? <><SettingsGroup title="Menu bar">
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
        <SettingsControlRow description="Calendar is the default icon." label="Menu bar icon">
          <div className="grid justify-items-end gap-2">
            <Select
              aria-label="Calendar menu bar icon"
              className={settingsSelectClass}
              onValueChange={(value) => {
                if (value === "custom") {
                  setCustomIconOpen(true);
                  return;
                }

                updateSettings({
                  menuBarCalendarIconId: value,
                  menuBarIconName: "calendar"
                });
              }}
              value={selectedMenuBarIconId(settings)}
            >
              <SelectItem value="calendar">Calendar</SelectItem>
              {settings.customMenuBarIcons.map((icon) => (
                <SelectItem key={icon.id} value={icon.id}>
                  {icon.name}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom +</SelectItem>
            </Select>
          </div>
        </SettingsControlRow>
        <SettingsControlRow label="Calendar done icon">
          <Select
            aria-label="Calendar done icon"
            className={settingsSelectClass}
            onValueChange={(value) =>
              updateSettings({
                menuBarCalendarDoneMode: value as SettingsSnapshot["menuBarCalendarDoneMode"]
              })
            }
            value={settings.menuBarCalendarDoneMode}
          >
            <SelectItem value="visibleTodayDone">Visible today done</SelectItem>
            <SelectItem value="tasksOnly">Tasks only</SelectItem>
            <SelectItem value="neverAutoSwitch">Never auto-switch</SelectItem>
          </Select>
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
      </> : null}
      {customIconOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
        >
          <div className="grid w-full max-w-lg gap-3 rounded-hcbLg border border-border bg-surface-0 p-4 shadow-hcbLg">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[var(--text-lg)] font-semibold text-text-primary">Select custom icon</h3>
              <Button onClick={() => setCustomIconOpen(false)} variant="ghost">
                Close
              </Button>
            </div>
            <p className="text-[var(--text-sm)] text-text-secondary">
              Choose a transparent PNG and give it a HCB name.
            </p>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem]">
              <div className="grid gap-3">
                <label className="grid gap-1 text-[var(--text-sm)] font-medium text-text-secondary">
                  Name
                  <input
                    className={cx(settingsSelectClass, "w-full")}
                    onChange={(event) => setCustomIconName(event.target.value)}
                    value={customIconName}
                  />
                </label>
                <label className="grid gap-1 text-[var(--text-sm)] font-medium text-text-secondary">
                  PNG
                  <input
                    accept="image/png"
                    className={cx(settingsSelectClass, "w-full")}
                    onChange={(event) => void selectCustomIconFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>
                {customIconFileName ? (
                  <p className="truncate text-[var(--text-sm)] text-text-secondary">{customIconFileName}</p>
                ) : null}
              </div>
              <div className="grid content-start gap-2">
                <div className="grid aspect-square w-32 place-items-center rounded-hcbMd border border-border bg-surface-1 text-text-primary">
                  {customIconPreviewUrl ? (
                    <img
                      alt="Menu bar icon preview"
                      className="h-8 w-8 object-contain"
                      src={customIconPreviewUrl}
                    />
                  ) : (
                    <span className="text-[var(--text-xs)] text-text-secondary">Preview</span>
                  )}
                </div>
              </div>
            </div>
            {customIconError ? <p className="text-[var(--text-sm)] text-danger">{customIconError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setCustomIconOpen(false)} variant="ghost">
                Cancel
              </Button>
              <Button onClick={() => void saveCustomIcon()} variant="primary">
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function selectedMenuBarIconId(settings: SettingsSnapshot): string {
  if (settings.menuBarCalendarIconId === "calendar") {
    return "calendar";
  }

  return settings.customMenuBarIcons.some((icon) => icon.id === settings.menuBarCalendarIconId)
    ? settings.menuBarCalendarIconId
    : "calendar";
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary);
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
      <Select
        aria-label="Completion sound"
        className={settingsSelectClass}
        onValueChange={(value) => onChange(value as SettingsSnapshot["taskCompletionSoundId"])}
        value={value}
      >
        {soundOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </Select>
      <Button onClick={onPreview} variant="ghost">
        <Play aria-hidden="true" size={14} />
        Preview
      </Button>
    </div>
  );
}
