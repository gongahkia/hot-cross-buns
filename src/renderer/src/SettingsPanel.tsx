import type { HealthCheckResponse } from "@shared/diagnostics";
import {
  type AppSettings,
  type SettingsDataInfo,
  type SettingsStartPage
} from "@shared/settings";

interface SettingsPanelProps {
  dataInfo: SettingsDataInfo | null;
  draft: AppSettings;
  error: string | null;
  health: HealthCheckResponse | null;
  isSaving: boolean;
  onChange: (settings: AppSettings) => void;
  onReset: () => void;
  onSave: () => void;
  status: string | null;
}

const startPageOptions: Array<{ value: SettingsStartPage; label: string }> = [
  { value: "today", label: "Today" },
  { value: "tasks", label: "Tasks" },
  { value: "calendar", label: "Calendar" },
  { value: "notes", label: "Notes" }
];

export function SettingsPanel({
  dataInfo,
  draft,
  error,
  health,
  isSaving,
  onChange,
  onReset,
  onSave,
  status
}: SettingsPanelProps): JSX.Element {
  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-5">
        <section aria-labelledby="appearance-heading" className="rounded-hcbMd border border-border bg-bg-secondary">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[var(--text-md)] font-semibold" id="appearance-heading">
              Appearance
            </h2>
            <p className="mt-1 text-[var(--text-sm)] text-text-muted">
              Choose how Hot Cross Buns follows your desktop color scheme.
            </p>
          </div>
          <div className="space-y-4 p-4">
            <fieldset>
              <legend className="text-[var(--text-sm)] font-medium text-text-secondary">
                Color scheme
              </legend>
              <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
                {[
                  ["system", "System", "Follow the desktop"],
                  ["dark", "Dark", "Always use dark"],
                  ["light", "Light", "Always use light"]
                ].map(([value, label, description]) => (
                  <label
                    className={[
                      "cursor-pointer rounded-hcbMd border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                      draft.colorScheme === value
                        ? "border-accent bg-surface-0"
                        : "border-border hover:bg-surface-0"
                    ].join(" ")}
                    key={value}
                  >
                    <input
                      checked={draft.colorScheme === value}
                      className="sr-only"
                      name="color-scheme"
                      onChange={() =>
                        onChange({
                          ...draft,
                          colorScheme: value as AppSettings["colorScheme"]
                        })
                      }
                      type="radio"
                      value={value}
                    />
                    <span className="block text-[var(--text-sm)] font-medium">{label}</span>
                    <span className="mt-1 block text-[var(--text-xs)] text-text-muted">
                      {description}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section aria-labelledby="startup-heading" className="rounded-hcbMd border border-border bg-bg-secondary">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[var(--text-md)] font-semibold" id="startup-heading">
              Startup
            </h2>
            <p className="mt-1 text-[var(--text-sm)] text-text-muted">
              Choose the workspace that opens after the app starts.
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <label className="min-w-0" htmlFor="start-page">
              <span className="block text-[var(--text-sm)] font-medium text-text-secondary">
                Open on startup
              </span>
              <span className="mt-1 block text-[var(--text-xs)] text-text-muted">
                The selection takes effect on the next launch.
              </span>
            </label>
            <select
              className="rounded-hcbMd border border-border bg-bg-primary px-3 py-2 text-[var(--text-sm)] text-text-primary focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
              id="start-page"
              onChange={(event) =>
                onChange({
                  ...draft,
                  startPage: event.target.value as SettingsStartPage
                })
              }
              value={draft.startPage}
            >
              {startPageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section aria-labelledby="sync-heading" className="rounded-hcbMd border border-border bg-bg-secondary">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[var(--text-md)] font-semibold" id="sync-heading">
              Google sync
            </h2>
          </div>
          <div className="p-4">
            <p className="text-[var(--text-sm)] font-medium text-text-secondary">Not configured</p>
            <p className="mt-1 text-[var(--text-sm)] text-text-muted">
              This build keeps tasks local. Google account setup and sync are not available yet.
            </p>
          </div>
        </section>

        <section aria-labelledby="data-heading" className="rounded-hcbMd border border-border bg-bg-secondary">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[var(--text-md)] font-semibold" id="data-heading">
              Local data
            </h2>
            <p className="mt-1 text-[var(--text-sm)] text-text-muted">
              Preferences and task data stay on this device.
            </p>
          </div>
          <dl className="divide-y divide-border text-[var(--text-sm)]">
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
              <dt className="font-medium text-text-secondary">Preferences</dt>
              <dd className="min-w-0 break-all font-mono text-[var(--text-xs)] text-text-muted">
                {dataInfo?.settingsFile ?? "Loading local path…"}
              </dd>
            </div>
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
              <dt className="font-medium text-text-secondary">Task data</dt>
              <dd className="min-w-0 break-all font-mono text-[var(--text-xs)] text-text-muted">
                {dataInfo?.plannerFile ?? "Loading local path…"}
              </dd>
            </div>
          </dl>
          <p className="border-t border-border px-4 py-3 text-[var(--text-xs)] text-text-muted">
            `settings-v1.json` is the editable preferences file. Close Hot Cross Buns before
            editing it manually. `planner-v1.json` contains local tasks and should be changed
            only through the app.
          </p>
        </section>

        <section aria-labelledby="diagnostics-heading" className="rounded-hcbMd border border-border bg-bg-secondary">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[var(--text-md)] font-semibold" id="diagnostics-heading">
              Diagnostics
            </h2>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-border text-[var(--text-sm)]">
            <div className="p-4">
              <dt className="text-text-muted">Version</dt>
              <dd className="mt-1 font-mono text-text-secondary">{health?.version ?? "Loading…"}</dd>
            </div>
            <div className="p-4">
              <dt className="text-text-muted">Runtime</dt>
              <dd className="mt-1 capitalize text-text-secondary">{health?.environment ?? "Loading…"}</dd>
            </div>
          </dl>
        </section>

        {error ? (
          <p className="rounded-hcbMd border border-danger/50 bg-danger/10 px-3 py-2 text-[var(--text-sm)] text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-bg-primary py-3">
          <p className="text-[var(--text-sm)] text-text-muted" role="status">
            {status ?? "Changes are saved only when you select Save changes."}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              className="rounded-hcbMd border border-border px-3 py-2 text-[var(--text-sm)] font-medium text-text-secondary hover:bg-surface-0 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
              onClick={() => {
                onReset();
              }}
              type="button"
            >
              Reset
            </button>
            <button
              className="rounded-hcbMd bg-accent px-3 py-2 text-[var(--text-sm)] font-medium text-bg-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onSave}
              type="button"
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
