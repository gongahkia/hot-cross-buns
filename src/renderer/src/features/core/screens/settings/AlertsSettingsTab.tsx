import type { SettingsSnapshot, SettingsUpdateRequest } from "@shared/ipc/contracts";
import { menuBarIconSvg, sanitizeMenuBarIconSvg } from "@shared/menuBarIcons";
import { useState } from "react";
import { Bell, Download, ExternalLink, Play, Volume2 } from "lucide-react";
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
  updateSettings
}: AlertsSettingsTabProps): JSX.Element {
  const [customIconOpen, setCustomIconOpen] = useState(false);
  const [customIconName, setCustomIconName] = useState("");
  const [customIconSvg, setCustomIconSvg] = useState("");
  const [customIconError, setCustomIconError] = useState<string | null>(null);
  const customIconPreviewSvg = sanitizeMenuBarIconSvg(customIconSvg);

  async function enableNotifications(checked: boolean): Promise<void> {
    if (checked) {
      await window.hcb?.native.requestNotificationPermission();
    }

    updateSettings({ notificationsEnabled: checked });
  }

  function saveCustomIcon(): void {
    const name = customIconName.trim();
    const svg = sanitizeMenuBarIconSvg(customIconSvg);
    if (!name || !svg) {
      setCustomIconError("Enter a name and a safe Lucide SVG.");
      return;
    }

    const now = new Date().toISOString();
    const id = `custom:${crypto.randomUUID()}`;
    updateSettings({
      customMenuBarIcons: [...settings.customMenuBarIcons, { id, name, svg, createdAt: now, updatedAt: now }],
      menuBarCalendarIconId: id
    });
    setCustomIconOpen(false);
    setCustomIconName("");
    setCustomIconSvg("");
    setCustomIconError(null);
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
        <SettingsControlRow description="Calendar is the default icon." label="Menu bar icon">
          <div className="grid justify-items-end gap-2">
            <select
              aria-label="Calendar menu bar icon"
              className={settingsSelectClass}
              onChange={(event) =>
                updateSettings({
                  menuBarCalendarIconId: event.target.value,
                  menuBarIconName: "calendar"
                })
              }
              value={selectedMenuBarIconId(settings)}
            >
              <option value="calendar">Calendar</option>
              {settings.customMenuBarIcons.map((icon) => (
                <option key={icon.id} value={icon.id}>
                  {icon.name}
                </option>
              ))}
            </select>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Badge>{selectedMenuBarIconName(settings)}</Badge>
              <Button onClick={() => setCustomIconOpen(true)} variant="secondary">
                Select custom...
              </Button>
            </div>
          </div>
        </SettingsControlRow>
        <SettingsControlRow label="Calendar done icon">
          <select
            aria-label="Calendar done icon"
            className={settingsSelectClass}
            onChange={(event) =>
              updateSettings({
                menuBarCalendarDoneMode: event.target.value as SettingsSnapshot["menuBarCalendarDoneMode"]
              })
            }
            value={settings.menuBarCalendarDoneMode}
          >
            <option value="visibleTodayDone">Visible today done</option>
            <option value="tasksOnly">Tasks only</option>
            <option value="neverAutoSwitch">Never auto-switch</option>
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
            <a
              className={cx(
                "inline-flex h-8 w-fit items-center justify-center gap-2 rounded-hcbMd border border-border bg-surface-0 px-3 text-[var(--text-base)] font-medium text-text-primary transition-colors duration-fast ease-hcb hover:bg-surface-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              )}
              href="https://lucide.dev/icons/"
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" size={14} />
              Open Lucide icons
            </a>
            <p className="text-[var(--text-sm)] text-text-secondary">
              Pick a Lucide icon, copy its SVG, paste it here, and give it a HCB2 name.
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
                  SVG
                  <textarea
                    className="min-h-32 rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary"
                    onChange={(event) => setCustomIconSvg(event.target.value)}
                    value={customIconSvg}
                  />
                </label>
              </div>
              <div className="grid content-start gap-2">
                <div className="grid aspect-square w-32 place-items-center rounded-hcbMd border border-border bg-surface-1 text-text-primary">
                  {customIconPreviewSvg ? (
                    <span
                      aria-label="Menu bar icon preview"
                      className="block h-8 w-8"
                      dangerouslySetInnerHTML={{
                        __html: menuBarIconSvg(customIconPreviewSvg)
                      }}
                      role="img"
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
              <Button onClick={saveCustomIcon} variant="primary">
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function selectedMenuBarIconName(settings: SettingsSnapshot): string {
  if (settings.menuBarCalendarIconId === "calendar") {
    return "Calendar";
  }

  return settings.customMenuBarIcons.find((icon) => icon.id === settings.menuBarCalendarIconId)?.name ?? "Calendar";
}

function selectedMenuBarIconId(settings: SettingsSnapshot): string {
  if (settings.menuBarCalendarIconId === "calendar") {
    return "calendar";
  }

  return settings.customMenuBarIcons.some((icon) => icon.id === settings.menuBarCalendarIconId)
    ? settings.menuBarCalendarIconId
    : "calendar";
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
