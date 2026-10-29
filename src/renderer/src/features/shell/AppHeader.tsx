import { useState } from "react";
import type { CalendarListSummary, SettingsSnapshot } from "@shared/ipc/contracts";
import {
  Eye, EyeOff,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { CalendarSourceSwatch } from "../core/screens/calendar/CalendarEventChips";
import { Button, cx } from "../../components/primitives";
import type { SectionId } from "../../data/mockPlanner";
import { useI18n } from "../../i18n";
import { ariaKeyShortcuts, displayAccelerator } from "../core/hotkeys";

import { MiniCalendar } from "./MiniCalendar";

type ToolbarActionId = SettingsSnapshot["toolbarActionOrder"][number];

export function AppHeader({
  sidebarMount, calendars, visibleCalendarIds, onToggleCalendar, onSelectCalendarDate,
  keybindings,
  activeSectionId,
  onNavigateToSection,
  onRefresh,
  onToggleSettings,
  settingsOpen,
  toolbarActionOrder
}: {
  onSelectCalendarDate: (date: string) => void;
  sidebarMount: (node: HTMLElement | null) => void;
  calendars: CalendarListSummary[];
  visibleCalendarIds: ReadonlySet<string>;
  onToggleCalendar: (id: string) => void;
  keybindings: SettingsSnapshot["keybindings"];
  activeSectionId: SectionId;
  onNavigateToSection: (sectionId: SectionId) => void;
  onRefresh: () => void;
  onToggleSettings: () => void;
  settingsOpen: boolean;
  toolbarActionOrder: SettingsSnapshot["toolbarActionOrder"];
}): JSX.Element {
  const { t } = useI18n();
  const [calendarSearch, setCalendarSearch] = useState("");
  const primaryNavigation = [
    {
      id: "calendar" as const,
      label: t("nav.calendar"),
      shortcut: keybindings["navigation.calendar"]
    },
    {
      id: "tasks" as const,
      label: t("nav.tasks"),
      shortcut: keybindings["navigation.tasks"]
    },
    {
      id: "notes" as const,
      label: t("nav.notes"),
      shortcut: keybindings["navigation.notes"]
    }
  ];
  const toolbarButtons: Partial<Record<ToolbarActionId, JSX.Element>> = {
    refresh: (
      <Button
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["sync.refresh"])}
        aria-label={t("action.refresh")}
        className="min-w-9 px-2"
        data-action-id="sync.refresh"
        key="refresh"
        onClick={onRefresh}
        title={t("action.refresh")}
        variant="ghost"
      >
        <RefreshCw aria-hidden="true" size={15} />
      </Button>
    ),
    settings: (
      <Button
        aria-expanded={settingsOpen}
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["navigation.settings"])}
        aria-label={t("action.settings")}
        className="min-w-9 px-2"
        key="settings"
        onClick={onToggleSettings}
        title={t("action.settings")}
        variant={settingsOpen ? "secondary" : "ghost"}
      >
        <Settings2 aria-hidden="true" size={15} />
      </Button>
    )
  };

  return (
    <aside aria-label="Workspace navigation" className="workspace-navigation flex min-h-0 w-[248px] shrink-0 flex-col border-r border-border bg-bg-secondary">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" id="planner-title">Hot Cross Buns</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      <MiniCalendar onSelectDate={onSelectCalendarDate} />
      <nav aria-label="Primary" className="grid gap-1 px-2">
        {primaryNavigation.map(({ id, label, shortcut }) => (
          <Button aria-current={activeSectionId === id ? "page" : undefined} aria-label={label} aria-keyshortcuts={ariaKeyShortcuts(shortcut)} className={cx("min-w-0 justify-start gap-2", "px-3", activeSectionId === id && "bg-surface-0 text-text-primary")} key={id} onClick={() => onNavigateToSection(id)} title={`${label} (${displayAccelerator(shortcut)})`} variant="ghost">
            <span>{label}</span>
          </Button>
        ))}
      </nav>
      <div className="mt-3 border-t border-border pt-3">
        {activeSectionId === "calendar" ? <div className="space-y-3 px-3">
          <p className="px-1 text-xs font-semibold text-text-muted">My calendars</p>
          <input aria-label="Filter calendars" className="w-full min-w-0 rounded-md border border-border bg-bg-primary px-2 text-xs" placeholder="Filter calendars…" value={calendarSearch} onChange={(event) => setCalendarSearch(event.target.value)} />
          <div className="grid gap-1">{calendars.filter((calendar) => calendar.title.toLowerCase().includes(calendarSearch.toLowerCase())).map((calendar) => <button key={calendar.id} className="calendar-source-toggle" aria-label={`${visibleCalendarIds.has(calendar.id) ? "Hide" : "Show"} ${calendar.title}`} aria-pressed={visibleCalendarIds.has(calendar.id)} onClick={() => onToggleCalendar(calendar.id)}>
            <CalendarSourceSwatch calendarId={calendar.id} color={calendar.backgroundColor} />
            <span className="truncate">{calendar.title}</span>
            {visibleCalendarIds.has(calendar.id) ? <Eye className="calendar-source-eye" size={16} /> : <EyeOff className="calendar-source-eye" size={16} />}
          </button>)}</div>
          {calendars.length === 0 ? <p className="text-xs text-text-muted">Add a calendar in Settings.</p> : null}
        </div> : null}
        <div ref={sidebarMount} className="section-navigation-slot" />
      </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1 border-t border-border p-2" role="toolbar" aria-label="Planner actions">
        {toolbarActionOrder.filter((id) => id !== "commandPalette" && id !== "diagnostics").map((id) => toolbarButtons[id])}
      </div>
    </aside>
  );
}
