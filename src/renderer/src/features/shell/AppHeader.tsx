import { useState } from "react";
import type { CalendarListSummary, SettingsSnapshot } from "@shared/ipc/contracts";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  CalendarDays,
  Columns2,
  Command,
  Gauge,
  ListTodo,
  RefreshCw,
  Settings2,
  StickyNote
} from "lucide-react";
import appIconUrl from "../../../../../assets/logo/logo.png";
import { Button, cx } from "../../components/primitives";
import type { SectionId } from "../../data/mockPlanner";
import { useI18n } from "../../i18n";
import { ariaKeyShortcuts, displayAccelerator } from "../core/hotkeys";

type ToolbarActionId = SettingsSnapshot["toolbarActionOrder"][number];

export function AppHeader({
  collapsed, onToggleCollapsed, sidebarMount, calendars, visibleCalendarIds, onToggleCalendar,
  commandPaletteOpen,
  diagnosticsOpen,
  keybindings,
  activeSectionId,
  onNavigateToSection,
  onOpenCommandPalette,
  onOpenSplitPane,
  onRefresh,
  onToggleDiagnostics,
  onToggleSettings,
  settingsOpen,
  toolbarActionOrder
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sidebarMount: (node: HTMLElement | null) => void;
  calendars: CalendarListSummary[];
  visibleCalendarIds: ReadonlySet<string>;
  onToggleCalendar: (id: string) => void;
  commandPaletteOpen: boolean;
  diagnosticsOpen: boolean;
  keybindings: SettingsSnapshot["keybindings"];
  activeSectionId: SectionId;
  onNavigateToSection: (sectionId: SectionId) => void;
  onOpenCommandPalette: () => void;
  onOpenSplitPane: () => void;
  onRefresh: () => void;
  onToggleDiagnostics: () => void;
  onToggleSettings: () => void;
  settingsOpen: boolean;
  toolbarActionOrder: SettingsSnapshot["toolbarActionOrder"];
}): JSX.Element {
  const { t } = useI18n();
  const [calendarSearch, setCalendarSearch] = useState("");
  const primaryNavigation = [
    {
      id: "calendar" as const,
      icon: CalendarDays,
      label: t("nav.calendar"),
      shortcut: keybindings["navigation.calendar"]
    },
    {
      id: "tasks" as const,
      icon: ListTodo,
      label: t("nav.tasks"),
      shortcut: keybindings["navigation.tasks"]
    },
    {
      id: "notes" as const,
      icon: StickyNote,
      label: t("nav.notes"),
      shortcut: keybindings["navigation.notes"]
    }
  ];
  const toolbarButtons: Partial<Record<ToolbarActionId, JSX.Element>> = {
    commandPalette: (
      <Button
        aria-expanded={commandPaletteOpen}
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["commandPalette.open"])}
        aria-label={t("action.commandPalette")}
        className={cx("min-w-9 px-2", collapsed && "size-10 px-0") }
        key="commandPalette"
        onClick={() => onOpenCommandPalette()}
        title={t("action.commandPalette")}
        variant={commandPaletteOpen ? "secondary" : "ghost"}
      >
        <Command aria-hidden="true" size={15} />
      </Button>
    ),
    diagnostics: (
      <Button
        aria-expanded={diagnosticsOpen}
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["navigation.diagnostics.toggle"])}
        aria-label={t("action.diagnostics")}
        className={cx("min-w-9 px-2", collapsed && "size-10 px-0") }
        key="diagnostics"
        onClick={onToggleDiagnostics}
        title={t("action.diagnostics")}
        variant={diagnosticsOpen ? "secondary" : "ghost"}
      >
        <Gauge aria-hidden="true" size={15} />
      </Button>
    ),
    splitPane: (
      <Button
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["pane.split.horizontal"])}
        aria-label={t("action.splitView")}
        className={cx("min-w-9 px-2", collapsed && "size-10 px-0") }
        key="splitPane"
        onClick={onOpenSplitPane}
        title={t("action.splitView")}
        variant="ghost"
      >
        <Columns2 aria-hidden="true" size={15} />
      </Button>
    ),
    refresh: (
      <Button
        aria-keyshortcuts={ariaKeyShortcuts(keybindings["sync.refresh"])}
        aria-label={t("action.refresh")}
        className={cx("min-w-9 px-2", collapsed && "size-10 px-0") }
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
        className={cx("min-w-9 px-2", collapsed && "size-10 px-0") }
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
    <aside aria-label="Workspace navigation" data-collapsed={collapsed} className={cx("workspace-navigation flex min-h-0 shrink-0 flex-col border-r border-border bg-bg-secondary", collapsed ? "w-14" : "w-[220px]")}>
      <div className="flex h-14 shrink-0 items-center gap-2 px-2">
        {!collapsed ? <><img alt="" className="size-6 rounded-md" draggable={false} src={appIconUrl} /><h1 className="min-w-0 flex-1 truncate text-sm font-semibold" id="planner-title">Hot Cross Buns</h1></> : null}
        <Button aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed} className="size-9 shrink-0 px-0" onClick={onToggleCollapsed} title={collapsed ? "Expand navigation" : "Collapse navigation"} variant="ghost">
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </Button>
      </div>
      <nav aria-label="Primary" className="grid gap-1 px-2">
        {primaryNavigation.map(({ icon: Icon, id, label, shortcut }) => (
          <Button aria-current={activeSectionId === id ? "page" : undefined} aria-label={label} aria-keyshortcuts={ariaKeyShortcuts(shortcut)} className={cx("min-w-0 justify-start gap-2", collapsed ? "px-2" : "px-3", activeSectionId === id && "bg-surface-0 text-text-primary")} key={id} onClick={() => onNavigateToSection(id)} title={`${label} (${displayAccelerator(shortcut)})`} variant="ghost">
            <Icon size={17} className="shrink-0" />
            {!collapsed ? <span>{label}</span> : null}
          </Button>
        ))}
      </nav>
      <Button aria-label="Search planner" className={cx("mx-2 mt-3 justify-start", collapsed ? "px-2" : "px-3")} onClick={() => onOpenCommandPalette()} title="Search planner" variant="ghost">
        <Search size={17} className="shrink-0" />{!collapsed ? <span>Search</span> : null}
      </Button>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-border pt-3">
        {activeSectionId === "calendar" && !collapsed ? <div className="space-y-3 px-3">
          <p className="px-1 text-xs font-semibold text-text-muted">My calendars</p>
          <input aria-label="Filter calendars" className="w-full min-w-0 rounded-md border border-border bg-bg-primary px-2 text-xs" placeholder="Filter calendars…" value={calendarSearch} onChange={(event) => setCalendarSearch(event.target.value)} />
          <div className="grid gap-1">{calendars.filter((calendar) => calendar.title.toLowerCase().includes(calendarSearch.toLowerCase())).map((calendar) => <label key={calendar.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-surface-0">
            <input type="checkbox" className="size-4 shrink-0 accent-[var(--color-accent)]" checked={visibleCalendarIds.has(calendar.id)} onChange={() => onToggleCalendar(calendar.id)} />
            <span className="truncate">{calendar.title}</span>
          </label>)}</div>
          {calendars.length === 0 ? <p className="text-xs text-text-muted">Add a calendar in Settings.</p> : null}
        </div> : null}
        <div ref={sidebarMount} className="section-navigation-slot" />
      </div>
      <div className={cx("flex shrink-0 gap-1 border-t border-border p-2", collapsed ? "flex-col" : "flex-wrap")} role="toolbar" aria-label="Planner actions">
        {toolbarActionOrder.filter((id) => id !== "commandPalette" && id !== "diagnostics").map((id) => toolbarButtons[id])}
      </div>
    </aside>
  );
}
