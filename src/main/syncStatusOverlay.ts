import type { SettingsSnapshot } from "@shared/ipc/contracts";
import {
  resolveEffectiveColorTheme,
  resolveEffectiveThemeMode,
  semanticThemeVariables
} from "@shared/ipc/themeCatalog";

export interface SyncStatusTheme {
  background: string;
  text: string;
  muted: string;
  track: string;
  fill: string;
}

export const fallbackSyncStatusTheme: SyncStatusTheme = {
  background: "#1e1e2e",
  text: "#cdd6f4",
  muted: "#bac2de",
  track: "#313244",
  fill: "#89b4fa"
};

export function resolveSyncStatusTheme(
  settings: Pick<SettingsSnapshot, "theme" | "colorTheme"> &
    Partial<Pick<SettingsSnapshot, "customBackground" | "useInferredBackgroundTheme">>,
  systemPrefersDark: boolean
): SyncStatusTheme {
  const mode = resolveEffectiveThemeMode(settings, systemPrefersDark);
  const colorTheme = resolveEffectiveColorTheme(settings, mode);
  const variables = semanticThemeVariables(colorTheme);

  return {
    background: variables["--color-bg-primary"] ?? fallbackSyncStatusTheme.background,
    text: variables["--color-text-primary"] ?? fallbackSyncStatusTheme.text,
    muted: variables["--color-text-secondary"] ?? fallbackSyncStatusTheme.muted,
    track: variables["--color-surface-1"] ?? fallbackSyncStatusTheme.track,
    fill: variables["--color-accent"] ?? fallbackSyncStatusTheme.fill
  };
}

export function syncStatusHtml(
  pendingMutationCount: number,
  theme: SyncStatusTheme = fallbackSyncStatusTheme
): string {
  const queuedWrites = String(Math.max(0, Math.floor(pendingMutationCount)));

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      :root {
        --sync-bg: ${theme.background};
        --sync-text: ${theme.text};
        --sync-muted: ${theme.muted};
        --sync-track: ${theme.track};
        --sync-fill: ${theme.fill};
      }
      body {
        margin: 0;
        background: var(--sync-bg);
        color: var(--sync-text);
        font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .wrap {
        display: grid;
        gap: 8px;
        height: 100vh;
        place-content: center;
        padding: 18px 22px;
        text-align: center;
      }
      .title { font-size: 15px; font-weight: 700; }
      .row { color: var(--sync-muted); line-height: 1.35; }
      .bar {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: var(--sync-track);
      }
      .bar::before {
        display: block;
        width: 55%;
        height: 100%;
        border-radius: inherit;
        background: var(--sync-fill);
        box-shadow: 0 0 16px var(--sync-fill);
        content: "";
        animation: pulse 1s ease-in-out infinite alternate;
      }
      @keyframes pulse { from { transform: translateX(-18%); } to { transform: translateX(90%); } }
    </style>
  </head>
  <body>
    <main class="wrap" role="status" aria-live="polite">
      <div class="title">Syncing</div>
      <div class="row">Queued writes: ${queuedWrites}<br>Removed: 0 up 0 down</div>
      <div class="bar"></div>
    </main>
  </body>
</html>`;
}
