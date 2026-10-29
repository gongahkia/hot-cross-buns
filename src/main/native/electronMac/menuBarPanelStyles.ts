import { defaultAppColorTheme, semanticThemeVariables } from "@shared/ipc/themeCatalog";
import type { NativeMenuBarSnapshot } from "../types";

/** Use the renderer's palette without loading its React tree into the native panel. */
export function menuBarPanelStyles(snapshot: NativeMenuBarSnapshot): string {
  const appearance = snapshot.appearance;
  const variables = (dark: boolean) => Object.entries(semanticThemeVariables(
    (dark ? appearance?.dark : appearance?.light) ?? defaultAppColorTheme(dark ? "dark" : "light")
  )).map(([key, value]) => `${key}: ${value};`).join("\n");
  const font = appearance?.fontName?.trim().replace(/[\\"]/g, "\\$&").replace(/[<>\n\r\f]/g, char => `\\${char.codePointAt(0)!.toString(16)} `);
  const textSize = Number.isFinite(appearance?.textSize) ? Math.max(9, Math.min(24, appearance!.textSize)) : 13;
  return `
    :root { ${variables(appearance?.theme === "dark")}
      color-scheme: ${appearance?.theme === "light" || appearance?.theme === "dark" ? appearance.theme : "light dark"};
      font: ${textSize}px ${font ? `"${font}",` : ""} -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: var(--color-text-primary); background: transparent;
      -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;
    }
    ${appearance?.theme === "light" || appearance?.theme === "dark" ? "" : `@media (prefers-color-scheme: dark) { :root { ${variables(true)} } }`}
    * { box-sizing: border-box; }
    body { margin: 0; overflow: hidden; }
    a { color: inherit; text-decoration: none; }
    a:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
    svg { display: block; flex-shrink: 0; }
    .popover { height: 100vh; overflow: hidden; border: 1px solid color-mix(in srgb, var(--color-text-primary) 16%, transparent); border-radius: 14px; background: var(--color-bg-primary); box-shadow: 0 8px 24px #0002; }
    .panel { height: 100%; display: flex; flex-direction: column; }
    .panel-header { padding: 18px 18px 14px; border-bottom: 1px solid var(--color-border); }
    .brand { display: flex; align-items: center; gap: 7px; color: var(--color-text-secondary); font-size: .85rem; margin-bottom: 10px; }
    .brand svg { color: var(--color-accent-text); }
    .heading-line { display: flex; align-items: baseline; gap: 12px; justify-content: space-between; }
    h1 { margin: 0; min-width: 0; font-size: 1.5rem; font-weight: 750; letter-spacing: -.035em; line-height: 1.25; text-wrap: balance; overflow-wrap: anywhere; }
    .sync-label { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--color-text-secondary); font-size: .85rem; }
    .sync-label::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .scroll-body { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 4px 12px 12px; scrollbar-width: thin; }
    .native-section { margin-top: 14px; }
    .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 6px 5px; color: var(--color-text-secondary); font-size: .85rem; font-weight: 600; }
    .section-count { border-radius: 12px; padding: 1px 7px; background: var(--color-bg-secondary); font-weight: 400; }
    .native-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) 14px; align-items: start; gap: 9px; min-height: 48px; padding: 9px 8px; border-radius: 8px; }
    a.native-row:hover, .quick-action:hover, .calendar-open:hover { background: var(--color-surface-0); }
    .row-icon { padding-top: 2px; color: var(--color-text-secondary); }
    .row-icon[data-kind="event"] { color: var(--color-accent-text); }
    .row-text { min-width: 0; }
    .row-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; line-height: 1.4; font-weight: 500; }
    .row-detail { display: block; margin-top: 3px; color: var(--color-text-secondary); font-size: .85rem; line-height: 1.4; }
    .row-open { align-self: center; color: var(--color-text-secondary); opacity: 0; }
    .native-row:hover .row-open, .native-row:focus-visible .row-open { opacity: 1; }
    .empty-row { grid-template-columns: minmax(0, 1fr); color: var(--color-text-secondary); margin: 4px 0 12px; background: var(--color-bg-secondary); }
    .account { display: flex; align-items: center; gap: 10px; padding: 14px 6px 2px; margin-top: 12px; border-top: 1px solid var(--color-border); }
    .account-copy { flex: 1; min-width: 0; }
    .account-name, .account-email { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.5; }
    .account-name { font-size: .9rem; font-weight: 500; }
    .account-email { color: var(--color-text-secondary); font-size: .8rem; }
    .account-avatar { display: grid; place-items: center; flex: none; width: 32px; height: 32px; overflow: hidden; border-radius: 50%; background: var(--color-surface-1); color: var(--color-text-secondary); }
    .account-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; outline: 1px solid oklch(0 0 0 / .1); outline-offset: -1px; }
    ${appearance?.theme === "dark" ? ".account-avatar img { outline-color: oklch(1 0 0 / .1); }" : appearance?.theme === "light" ? "" : "@media (prefers-color-scheme: dark) { .account-avatar img { outline-color: oklch(1 0 0 / .1); } }"}
    .panel-footer { flex-shrink: 0; padding: 10px 12px 12px; border-top: 1px solid var(--color-border); background: var(--color-bg-secondary); }
    .open-app { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; padding: 9px 12px; border-radius: 8px; background: var(--color-bg-primary); box-shadow: 0 1px 3px #0001; font-weight: 600; }
    .open-app:hover { background: var(--color-surface-1); }
    .quick-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 6px; }
    .quick-action { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 6px 4px; border-radius: 7px; color: var(--color-text-secondary); font-size: .85rem; }
    .calendar-wrap { padding-top: 14px; }
    .calendar-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-left: 6px; }
    .calendar-title { flex: 1; font-size: 1rem; font-weight: 600; }
    .calendar-open { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 8px; color: var(--color-text-secondary); }
    .weekday-grid, .day-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
    .weekday { padding-bottom: 8px; color: var(--color-text-secondary); font-size: .8rem; text-align: center; }
    .day { display: grid; place-items: center; height: 32px; border-radius: 7px; font-size: .9rem; }
    .day.muted { color: var(--color-text-muted); }
    .day.selected { background: var(--color-accent); color: var(--color-accent-foreground); font-weight: 600; }
    .day.today:not(.selected) { box-shadow: inset 0 0 0 1px var(--color-accent); }
    .selected-agenda { border-top: 1px solid var(--color-border); margin-top: 14px; padding-top: 14px; }
    .selected-header { padding: 0 6px 6px; }
    .selected-title { margin: 0; font-size: 1rem; font-weight: 600; }
    .secondary { margin-top: 4px; color: var(--color-text-secondary); font-size: .85rem; }
    ${appearance?.disableAnimations ? "" : "a { transition: background-color 120ms ease-out, color 120ms ease-out; } .row-open { transition: opacity 120ms ease-out; }"}
    @media (prefers-reduced-motion: reduce) { a, .row-open { transition: none; } }
  `;
}
