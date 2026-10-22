import type { NativeRoute } from "@shared/ipc/contracts";
import type { NativeMenuBarItem, NativeMenuBarSnapshot } from "../types";
import { menuBarPanelStyles } from "./menuBarPanelStyles";

export function menuBarPanelDataUrl(snapshot: NativeMenuBarSnapshot): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(menuBarPanelHtml(snapshot))}`;
}

// Static Lucide-style line icons keep this script-free native surface lightweight.
function icon(name: "calendar" | "task" | "open" | "refresh" | "settings" | "quit" | "search"): string {
  const paths = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
    task: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
    open: '<path d="M7 17 17 7M7 7h10v10"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-2L20 8M4 16l2.4 3A7 7 0 0 0 18 17"/>',
    settings: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    quit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5M21 12H9"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'
  };
  return `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

export function menuBarPanelHtml(snapshot: NativeMenuBarSnapshot): string {
  const calendar = snapshot.panelStyle === "calendar" ? snapshot.calendar : undefined;
  const heading = calendar ? "Calendar" : snapshot.panelStyle === "adaptive" ? "Agenda" : "Today";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; navigate-to hcb-panel:">
    <title>Hot Cross Buns menu bar panel</title><style>${menuBarPanelStyles(snapshot)}</style></head>
    <body><div class="popover"><main class="panel">
      <header class="panel-header">
        <div class="brand">${icon("calendar")}<span>Hot Cross Buns</span></div>
        <div class="heading-line"><h1>${heading}</h1></div>
        ${snapshot.subtitle ? `<div class="secondary">${escapeHtml(snapshot.subtitle)}</div>` : ""}
        <span class="sync-label" title="This panel shows the cached planner snapshot. Refresh checks Google for changes.">${escapeHtml(snapshot.syncLabel)}</span>
      </header>
      <div class="scroll-body${calendar ? " calendar-wrap" : ""}">
        ${calendar ? calendarMarkup(calendar) : nativeSectionsMarkup(snapshot.sections)}
        ${calendar ? nativeSectionsMarkup(snapshot.sections.filter(section => section.title === "Pinned filters")) : ""}
        ${accountMarkup(snapshot)}
      </div>
      ${quickActionsMarkup()}
    </main></div></body></html>`;
}

function calendarMarkup(calendar: NonNullable<NativeMenuBarSnapshot["calendar"]>): string {
  const days = calendar.days.map(day => `<span class="day${day.inCurrentMonth ? "" : " muted"}${day.isToday ? " today" : ""}${day.isSelected ? " selected" : ""}"${day.isToday ? ' aria-current="date"' : ""} aria-label="${escapeHtml(day.key)}">${escapeHtml(day.label)}</span>`).join("");
  return `<section aria-label="Month overview">
    <div class="calendar-header"><span class="calendar-title">${escapeHtml(calendar.monthLabel)}</span>
      <a class="calendar-open" href="${panelRouteHref({ kind: "today" })}" aria-label="Open today in Calendar" title="Open today in Calendar">${icon("open")}</a>
    </div>
    <div class="weekday-grid">${calendar.weekdayLabels.map(label => `<span class="weekday">${escapeHtml(label)}</span>`).join("")}</div>
    <div class="day-grid">${days}</div>
  </section>
  <section class="selected-agenda" aria-label="Today's agenda">
    <div class="selected-header"><h2 class="selected-title">${escapeHtml(calendar.selectedLabel)}</h2><div class="secondary">${escapeHtml(calendar.selectedMeta)}</div></div>
    ${rowsMarkup(calendar.selectedItems)}
  </section>`;
}

function nativeSectionsMarkup(sections: NativeMenuBarSnapshot["sections"]): string {
  return sections.map(section => {
    const count = section.items.filter(item => item.route || item.action).length;
    return `<section class="native-section">${section.title ? `<h2 class="section-heading"><span>${escapeHtml(section.title)}</span>${count ? `<span class="section-count">${count}</span>` : ""}</h2>` : ""}${rowsMarkup(section.items)}</section>`;
  }).join("");
}

function rowsMarkup(items: NativeMenuBarItem[]): string {
  return items.map(item => {
    const href = menuBarItemHref(item), enabled = href !== "#";
    const kind = item.route?.kind;
    const symbol = kind === "task" ? "task" : kind === "search" ? "search" : "calendar";
    const label = item.fullLabel ?? item.label;
    const body = `<span class="row-icon" data-kind="${symbol === "calendar" ? "event" : symbol}">${icon(symbol)}</span><span class="row-text"><span class="row-title">${escapeHtml(label)}</span>${item.detail ? `<span class="row-detail">${escapeHtml(item.detail)}</span>` : ""}</span>${enabled ? `<span class="row-open">${icon("open")}</span>` : ""}`;
    return enabled ? `<a class="native-row" href="${escapeHtml(href)}" title="${escapeHtml(label)}">${body}</a>` : `<div class="native-row empty-row">${body}</div>`;
  }).join("");
}

function accountMarkup(snapshot: NativeMenuBarSnapshot): string {
  if (!snapshot.account) return "";
  const account = snapshot.account;
  const avatar = account.avatarUrl ? `<img alt="" referrerpolicy="no-referrer" src="${escapeHtml(account.avatarUrl)}">` : escapeHtml(account.displayName.trim().charAt(0) || "G");
  return `<section class="account" aria-label="Google account"><span class="account-avatar" aria-hidden="true">${avatar}</span><span class="account-copy"><span class="account-name" title="${escapeHtml(account.displayName)}">${escapeHtml(account.displayName)}</span>${account.email ? `<span class="account-email" title="${escapeHtml(account.email)}">${escapeHtml(account.email)}</span>` : ""}</span></section>`;
}

function quickActionsMarkup(): string {
  return `<footer class="panel-footer"><a class="open-app" href="${panelActionHref("showWindow")}"><span>Open Hot Cross Buns</span>${icon("open")}</a>
    <nav class="quick-actions" aria-label="Menu bar actions">
      <a class="quick-action" href="${panelActionHref("refresh")}">${icon("refresh")}<span>Refresh</span></a>
      <a class="quick-action" href="${panelActionHref("openSettings")}">${icon("settings")}<span>Settings</span></a>
      <a class="quick-action" href="${panelActionHref("quit")}">${icon("quit")}<span>Quit</span></a>
    </nav></footer>`;
}

function menuBarItemHref(item: NativeMenuBarItem): string {
  if (item.route) {
    return panelRouteHref(item.route);
  }

  if (item.action) {
    return panelActionHref(item.action);
  }

  return "#";
}

export function panelRouteHref(route: NativeRoute): string {
  const params = new URLSearchParams({ kind: route.kind });

  if (route.id) {
    params.set("id", route.id);
  }

  if (route.query) {
    params.set("query", route.query);
  }

  return `hcb-panel://route?${params.toString()}`;
}

export function panelActionHref(action: NonNullable<NativeMenuBarItem["action"]>): string {
  return `hcb-panel://action?name=${encodeURIComponent(action)}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
