import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ListTodo,
  Search,
  Settings,
  StickyNote
} from "lucide-react";
import type { HealthCheckResponse } from "@shared/diagnostics";
import type { PlannerSyncStatus, PlannerTask, PlannerWorkspace } from "@shared/planner";
import {
  defaultAppSettings,
  type AppSettings,
  type SettingsDataInfo
} from "@shared/settings";
import { SettingsPanel } from "./SettingsPanel";

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
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [workspace, setWorkspace] = useState<PlannerWorkspace | null>(null);
  const [syncStatus, setSyncStatus] = useState<PlannerSyncStatus | null>(null);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(defaultAppSettings);
  const [settingsDataInfo, setSettingsDataInfo] = useState<SettingsDataInfo | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const shellVisibleReported = useRef(false);
  const initialStartPageApplied = useRef(false);

  const activeSection = useMemo(() => sectionById(activeSectionId), [activeSectionId]);
  const ActiveIcon = activeSection.icon;
  const metricFor = useCallback(
    (section: SectionId, fallback: string) => {
      if (!workspace) {
        return fallback;
      }

      if (section === "today" || section === "tasks") {
        return `${workspace.openTaskCount} open`;
      }
      if (section === "search") {
        return workspace.searchIndexState;
      }
      return fallback;
    },
    [workspace]
  );

  const refreshPlanner = useCallback(async () => {
    const planner = window.hcb?.planner;
    if (!planner) {
      return;
    }

    const [workspaceResult, taskResult, syncResult] = await Promise.all([
      planner.workspace(),
      planner.listTasks({ query: "", status: "open", limit: 50 }),
      planner.syncStatus()
    ]);

    if (workspaceResult.ok) {
      setWorkspace(workspaceResult.data);
    }
    if (taskResult.ok) {
      setTasks(taskResult.data.tasks);
    }
    if (syncResult.ok) {
      setSyncStatus(syncResult.data);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    window.hcb?.diagnostics.health().then((result) => {
      if (cancelled) {
        return;
      }

      if (result.ok) {
        setHealthLabel("Ready");
        setHealth(result.data);
      } else {
        setHealthLabel("Diagnostics unavailable");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const settingsApi = window.hcb?.settings;
    if (!settingsApi) {
      return;
    }

    void Promise.all([settingsApi.get(), settingsApi.dataInfo()])
      .then(([settingsResult, dataInfoResult]) => {
        if (cancelled) {
          return;
        }

        if (settingsResult.ok) {
          setSettings(settingsResult.data);
          setSettingsDraft(settingsResult.data);
          if (!initialStartPageApplied.current) {
            initialStartPageApplied.current = true;
            setActiveSectionId(settingsResult.data.startPage);
          }
        } else {
          setSettingsError(settingsResult.error.message);
        }

        if (dataInfoResult.ok) {
          setSettingsDataInfo(dataInfoResult.data);
        } else {
          setSettingsError(dataInfoResult.error.message);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettingsError("Settings are unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const preference = settings.colorScheme;
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: light)");
    const applyColorScheme = () => {
      const resolved = preference === "system" ? (mediaQuery?.matches ? "light" : "dark") : preference;
      document.documentElement.dataset.theme = resolved;
    };

    applyColorScheme();
    if (preference !== "system" || !mediaQuery) {
      return;
    }

    mediaQuery.addEventListener?.("change", applyColorScheme);
    return () => {
      mediaQuery.removeEventListener?.("change", applyColorScheme);
    };
  }, [settings.colorScheme]);

  useEffect(() => {
    if (shellVisibleReported.current) {
      return;
    }

    shellVisibleReported.current = true;
    requestAnimationFrame(() => {
      void window.hcb?.diagnostics.markShellVisible();
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void refreshPlanner().catch(() => {
      if (!cancelled) {
        setTaskError("Local planner data is unavailable");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshPlanner]);

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTaskTitle.trim();
    const planner = window.hcb?.planner;
    if (!title || !planner || isSavingTask) {
      return;
    }

    setIsSavingTask(true);
    setTaskError(null);
    try {
      const result = await planner.saveTask({
        title,
        notes: "",
        dueDate: null,
        idempotencyKey: requestKey("save-task")
      });
      if (!result.ok) {
        setTaskError(result.error.message);
        return;
      }

      setNewTaskTitle("");
      await refreshPlanner();
    } catch {
      setTaskError("Task could not be saved locally");
    } finally {
      setIsSavingTask(false);
    }
  }

  async function completeTask(task: PlannerTask) {
    const planner = window.hcb?.planner;
    if (!planner) {
      return;
    }

    setTaskError(null);
    const result = await planner.completeTask({
      id: task.id,
      completed: true,
      idempotencyKey: requestKey("complete-task")
    });
    if (!result.ok) {
      setTaskError(result.error.message);
      return;
    }

    await refreshPlanner();
  }

  async function saveSettings() {
    const settingsApi = window.hcb?.settings;
    if (!settingsApi || isSavingSettings) {
      return;
    }

    setIsSavingSettings(true);
    setSettingsError(null);
    setSettingsStatus(null);
    try {
      const result = await settingsApi.save(settingsDraft);
      if (!result.ok) {
        setSettingsError(result.error.message);
        return;
      }

      setSettings(result.data);
      setSettingsDraft(result.data);
      setSettingsStatus("Saved to settings-v1.json.");
    } catch {
      setSettingsError("Settings could not be saved locally");
    } finally {
      setIsSavingSettings(false);
    }
  }

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
            <div className="truncate text-[var(--text-md)] font-semibold">Hot Cross Buns</div>
            <div className="text-[var(--text-xs)] text-text-muted">
              {syncStatus?.pendingMutationCount
                ? `${syncStatus.pendingMutationCount} change${syncStatus.pendingMutationCount === 1 ? "" : "s"} queued`
                : "Local changes up to date"}
            </div>
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
                <span className="text-[var(--text-xs)] text-text-muted">
                  {metricFor(section.id, section.metric)}
                </span>
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
          {activeSectionId === "settings" ? (
            <SettingsPanel
              dataInfo={settingsDataInfo}
              draft={settingsDraft}
              error={settingsError}
              health={health}
              isSaving={isSavingSettings}
              onChange={(nextSettings) => {
                setSettingsDraft(nextSettings);
                setSettingsError(null);
                setSettingsStatus("Unsaved changes");
              }}
              onReset={() => {
                setSettingsDraft(defaultAppSettings);
                setSettingsError(null);
                setSettingsStatus("Defaults are ready to save.");
              }}
              onSave={() => void saveSettings()}
              status={settingsStatus}
            />
          ) : (
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
                  {metricFor(activeSection.id, activeSection.metric)}
                </span>
              </div>
              {activeSectionId === "tasks" ? (
                <div className="flex h-[calc(100%-2.5rem)] min-h-0 flex-col p-3">
                  <form className="flex gap-2" onSubmit={saveTask}>
                    <label className="sr-only" htmlFor="new-task-title">
                      New task title
                    </label>
                    <input
                      aria-label="New task title"
                      className="min-w-0 flex-1 rounded-hcbMd border border-border bg-bg-primary px-3 py-2 text-[var(--text-sm)] text-text-primary placeholder:text-text-muted focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
                      id="new-task-title"
                      onChange={(event) => setNewTaskTitle(event.target.value)}
                      placeholder="Add a local task"
                      value={newTaskTitle}
                    />
                    <button
                      className="rounded-hcbMd bg-accent px-3 py-2 text-[var(--text-sm)] font-medium text-bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!newTaskTitle.trim() || isSavingTask}
                      type="submit"
                    >
                      {isSavingTask ? "Saving" : "Add task"}
                    </button>
                  </form>
                  {taskError ? (
                    <p className="mt-2 text-[var(--text-sm)] text-danger" role="alert">
                      {taskError}
                    </p>
                  ) : null}
                  <ul aria-label="Open tasks" className="mt-3 min-h-0 divide-y divide-border overflow-y-auto">
                    {tasks.map((task) => (
                      <li className="flex items-center gap-3 py-3" key={task.id}>
                        <button
                          aria-label={`Complete ${task.title}`}
                          className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-success hover:border-success focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
                          onClick={() => void completeTask(task)}
                          type="button"
                        >
                          <CheckCircle2 aria-hidden="true" size={13} />
                        </button>
                        <span className="min-w-0 flex-1 truncate text-[var(--text-sm)] text-text-primary">
                          {task.title}
                        </span>
                        {task.dueDate ? (
                          <span className="text-[var(--text-xs)] text-text-muted">{task.dueDate}</span>
                        ) : null}
                      </li>
                    ))}
                    {tasks.length === 0 ? (
                      <li className="py-8 text-center text-[var(--text-sm)] text-text-muted">
                        Add a task to start a local, durable queue.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : (
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
              )}
            </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function requestKey(operation: string): string {
  return `${operation}-${Date.now()}-${Math.random().toString(36).slice(2)}-electron`;
}
