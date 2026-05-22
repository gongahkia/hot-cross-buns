import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ListTodo,
  Search,
  Settings,
  StickyNote
} from "lucide-react";

type SectionId = "today" | "tasks" | "calendar" | "notes" | "search" | "settings";

interface PlannerSection {
  id: SectionId;
  label: string;
  title: string;
  status: string;
  metric: string;
  icon: typeof CalendarDays;
  rows: string[];
}

const sections: PlannerSection[] = [
  {
    id: "today",
    label: "Today",
    title: "Today",
    status: "Planner",
    metric: "0 due",
    icon: CalendarDays,
    rows: ["No cached tasks", "No cached events", "No local notes linked"]
  },
  {
    id: "tasks",
    label: "Tasks",
    title: "Tasks",
    status: "Task cache",
    metric: "0 open",
    icon: ListTodo,
    rows: ["Inbox empty", "No task lists selected", "Mutation queue idle"]
  },
  {
    id: "calendar",
    label: "Calendar",
    title: "Calendar",
    status: "Calendar cache",
    metric: "0 events",
    icon: ClipboardList,
    rows: ["Agenda empty", "No calendars selected", "Sync checkpoint unavailable"]
  },
  {
    id: "notes",
    label: "Notes",
    title: "Notes",
    status: "Local notes",
    metric: "0 notes",
    icon: StickyNote,
    rows: ["No local notes", "Search index idle", "Local-only storage pending"]
  },
  {
    id: "search",
    label: "Search",
    title: "Search",
    status: "Local index",
    metric: "0 results",
    icon: Search,
    rows: ["No query", "Tasks unavailable", "Calendar unavailable"]
  },
  {
    id: "settings",
    label: "Settings",
    title: "Settings",
    status: "Preferences",
    metric: "6 areas",
    icon: Settings,
    rows: ["Google disconnected", "Appearance default", "Diagnostics ready"]
  }
];

function sectionById(id: SectionId): PlannerSection {
  return sections.find((section) => section.id === id) ?? sections[0];
}

export default function App(): JSX.Element {
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("today");
  const [healthLabel, setHealthLabel] = useState("Starting");
  const shellVisibleReported = useRef(false);

  const activeSection = useMemo(() => sectionById(activeSectionId), [activeSectionId]);
  const ActiveIcon = activeSection.icon;

  useEffect(() => {
    let cancelled = false;

    window.hcb?.diagnostics.health().then((result) => {
      if (cancelled) {
        return;
      }

      setHealthLabel(result.ok ? "Ready" : "Diagnostics unavailable");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (shellVisibleReported.current) {
      return;
    }

    shellVisibleReported.current = true;
    requestAnimationFrame(() => {
      void window.hcb?.diagnostics.markShellVisible();
    });
  }, []);

  return (
    <div
      className="grid h-screen min-h-[620px] grid-cols-[232px_minmax(0,1fr)] bg-bg-primary text-text-primary"
      data-testid="app-shell"
    >
      <aside className="flex min-h-0 flex-col border-r border-border bg-bg-secondary">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <div className="flex size-8 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
            <CheckCircle2 aria-hidden="true" size={18} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[var(--text-md)] font-semibold">Hot Cross Buns 2</div>
            <div className="text-[var(--text-xs)] text-text-muted">Sync idle</div>
          </div>
        </div>

        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-2 py-3">
          {sections.map((section) => {
            const Icon = section.icon;
            const selected = section.id === activeSectionId;

            return (
              <button
                aria-current={selected ? "page" : undefined}
                className={[
                  "flex h-9 w-full items-center gap-3 rounded-hcbMd px-3 text-left text-[var(--text-base)] transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  selected
                    ? "bg-surface-0 text-text-primary"
                    : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
                ].join(" ")}
                key={section.id}
                onClick={() => setActiveSectionId(section.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={16} strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                <span className="text-[var(--text-xs)] text-text-muted">{section.metric}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-3 text-[var(--text-xs)] text-text-muted">
          <div className="flex items-center justify-between gap-3">
            <span>Runtime</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-text-secondary">
              {healthLabel}
            </span>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-bg-primary px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-hcbMd bg-surface-0 text-accent">
              <ActiveIcon aria-hidden="true" size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[var(--text-xl)] font-bold" id="planner-title">
                {activeSection.title}
              </h1>
              <p className="text-[var(--text-sm)] text-text-muted">{activeSection.status}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[var(--text-sm)] text-text-secondary">
            <span className="size-2 rounded-full bg-success" />
            <span>Local shell</span>
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-hidden p-5" aria-labelledby="planner-title">
          <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4">
            <div className="grid grid-cols-3 gap-3">
              {activeSection.rows.map((row) => (
                <div
                  className="min-h-20 rounded-hcbMd border border-border bg-bg-secondary p-3"
                  key={row}
                >
                  <div className="text-[var(--text-sm)] font-medium text-text-secondary">{row}</div>
                  <div className="mt-3 h-2 w-16 rounded-full bg-surface-0" />
                </div>
              ))}
            </div>

            <div className="min-h-0 rounded-hcbMd border border-border bg-bg-secondary">
              <div className="flex h-10 items-center justify-between border-b border-border px-3">
                <span className="text-[var(--text-sm)] font-medium text-text-secondary">
                  {activeSection.title}
                </span>
                <span className="font-mono text-[var(--text-xs)] text-text-muted">
                  {activeSection.metric}
                </span>
              </div>
              <div className="grid h-[calc(100%-2.5rem)] place-items-center px-6 text-center">
                <div className="max-w-sm">
                  <div className="mx-auto flex size-10 items-center justify-center rounded-hcbMd border border-border bg-surface-0 text-accent">
                    <ActiveIcon aria-hidden="true" size={20} />
                  </div>
                  <p className="mt-3 text-[var(--text-md)] font-medium text-text-secondary">
                    No local data loaded
                  </p>
                  <p className="mt-1 text-[var(--text-sm)] text-text-muted">
                    {activeSection.status}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
