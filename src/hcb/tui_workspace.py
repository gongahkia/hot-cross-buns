"""Workspace loading, rendering, and selection handlers."""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any, cast
from zoneinfo import ZoneInfo

from textual.widgets import (
    Button,
    ListView,
    Static,
)

from .application import (
    SearchResult,
)
from .models import DriveFile, Event, Task, TaskStatus
from .tui_components import (
    CachedWorkspace,
    EntityRow,
    LoadingScreen,
)

if TYPE_CHECKING:
    pass


class WorkspaceMixin:
    loading_operation: str | None
    _loading_screen: LoadingScreen | None

    def refresh_workspace(self: Any) -> None:
        """Refresh the UI cache through the application controller boundary."""
        if self.account_id is None:
            self.cache = CachedWorkspace()
            self._render_onboarding()
            return
        snapshot = self.runtime.application.workspace(self.account_id)
        notes_enabled = (
            self.runtime.application.notes_projection(self.account_id).value != "disabled"
        )
        self.query_one("#surface-notes", Button).display = notes_enabled
        if not notes_enabled and self.surface == "Notes":
            self.surface = "Tasks"
        self.cache = CachedWorkspace(
            identity=snapshot.account.email,
            tasks=snapshot.tasks,
            events=snapshot.events,
            task_lists=tuple((item.id, item.title) for item in snapshot.task_lists),
            calendars=tuple((item.id, item.summary, item.selected) for item in snapshot.calendars),
            instance_ranges=tuple(self.runtime.storage.list_instance_ranges(self.account_id)),
            pending=snapshot.pending,
        )
        self.marked.intersection_update(task.id for task in self.cache.tasks)
        self.marked_events.intersection_update(event.id for event in self.cache.events)
        self._render_chrome()
        self._render_surface()

    def _render_onboarding(self: Any) -> None:
        self.query_one("#topbar", Static).update("HCB  ·  offline workspace")
        self._render_mini_month()
        self.query_one("#resources", ListView).clear()
        self.query_one("#sync-state", Static).update("Not connected · no network activity")
        self.query_one("#surface-title", Static).update("Welcome")
        content = self.query_one("#content", ListView)
        content.clear()
        content.append(
            EntityRow(
                "No account configured. Run: hcb auth connect ACCOUNT EMAIL",
                kind="onboarding",
                item_id="connect",
            )
        )

    def _render_chrome(self: Any, *, refresh_resources: bool = True) -> None:
        """Refresh chrome; only rebuild resources when workspace data has changed."""
        self.query_one("#topbar", Static).update(
            f"HCB  ·  {self.cache.identity}  ·  {self.format_date(self._present_date())}"
            "  ·  / command palette"
        )
        self._render_mini_month()
        if refresh_resources:
            resources = self.query_one("#resources", ListView)
            resources.clear()
            resources.append(EntityRow("All resources", kind="resource-all", item_id="all"))
            for item_id, title in self.cache.task_lists:
                resources.append(EntityRow(f"☐ {title}", kind="task-list", item_id=item_id))
            for item_id, title, _ in self.cache.calendars:
                resources.append(EntityRow(f"□ {title}", kind="calendar", item_id=item_id))
        self._update_resource_selection()
        state = self.loading_operation or "offline cache"
        cache_badge = self._instance_cache_badge()
        suffix = f" · {cache_badge}" if cache_badge else ""
        self.query_one("#sync-state", Static).update(
            f"{state} · {self.cache.pending} pending{suffix}"
        )

    def start_loading(self: Any, operation: str, *, cancellable: bool = False) -> None:
        """Show the selected loader while one explicit remote operation is in progress."""
        self.loading_operation = operation
        if self._loading_screen is None:
            self._loading_screen = LoadingScreen(operation, cancellable=cancellable)
            self.push_screen(self._loading_screen)
        else:
            self._loading_screen.set_message(operation)
        self._render_chrome(refresh_resources=False)

    def cancel_sync(self: Any) -> None:
        """Ask the active sync to stop before its next Google request."""
        if not self._sync_lock.locked():
            return
        self._sync_cancel.set()
        self.update_loading("Cancelling sync after the current request")

    def update_loading(self: Any, status: str) -> None:
        """Display the current, concrete stage of the active remote operation."""
        self.loading_operation = status
        if self._loading_screen is not None:
            self._loading_screen.set_message(status)
        self._render_chrome(refresh_resources=False)

    def stop_loading(self: Any) -> None:
        """Remove the active loading surface after its worker has completed."""
        screen = self._loading_screen
        self.loading_operation = None
        self._loading_screen = None
        if screen is not None and self.screen is screen:
            self.pop_screen()
        self._render_chrome(refresh_resources=False)

    def _render_mini_month(self: Any) -> None:
        """Render date controls for the sidebar's current calendar month."""
        cal = calendar.TextCalendar(self.runtime.config.preferences.week_starts_on)
        self.query_one("#mini-month-title", Static).update(f"{self.selected_date:%B %Y}")
        weekdays = cal.formatweekheader(2)
        if self.border_style != "ascii":
            weekdays = weekdays.replace(" ", " ")
        self.query_one("#mini-month-weekdays", Static).update(weekdays)
        weeks = calendar.Calendar(self.runtime.config.preferences.week_starts_on).monthdayscalendar(
            self.selected_date.year, self.selected_date.month
        )
        self._mini_month_days.clear()
        for week_index in range(6):
            days = weeks[week_index] if week_index < len(weeks) else (0,) * 7
            for weekday, day in enumerate(days):
                button = self.query_one(f"#mini-day-{week_index}-{weekday}", Button)
                # A standard Button adds one cell of implicit line padding on each side.
                # Day cells can be two columns wide in the narrow layout, so remove it.
                button.styles.line_pad = 0
                target = (
                    date(self.selected_date.year, self.selected_date.month, day) if day else None
                )
                button.label = str(day) if day else ""
                button.disabled = target is None
                button.set_class(target == self.selected_date, "mini-day-selected")
                if target is not None and button.id is not None:
                    self._mini_month_days[button.id] = target

    def _select_date(self: Any, value: date) -> None:
        """Apply a local date navigation without disturbing the resource list."""
        if value == self.selected_date:
            return
        self.selected_date = value
        self._render_chrome(refresh_resources=False)
        self._render_surface()

    def _present_date(self: Any) -> date:
        """Return today's date in the user's configured timezone."""
        return datetime.now(ZoneInfo(self.runtime.config.preferences.time_zone)).date()

    def format_date(self: Any, value: date) -> str:
        """Render a date using the selected user-facing display style."""
        if self.runtime.config.preferences.date_time_format == "iso":
            return value.isoformat()
        return f"{value.day} {value:%B %Y}"

    def format_time(self: Any, value: datetime) -> str:
        """Render an instant in the configured local timezone."""
        local = cast(datetime, self._local_time(value))
        style = self.runtime.config.preferences.date_time_format
        if style == "iso":
            return local.isoformat()
        if style == "friendly_24h":
            return f"{local.hour:02d}:{local.minute:02d}"
        hour = local.hour % 12 or 12
        suffix = "am" if local.hour < 12 else "pm"
        return f"{hour}:{local.minute:02d}{suffix}"

    def format_date_time(self: Any, value: date | datetime) -> str:
        """Render all-day values as dates and timed values with local clock time."""
        if not isinstance(value, datetime):
            return str(self.format_date(value))
        if self.runtime.config.preferences.date_time_format == "iso":
            return cast(datetime, self._local_time(value)).isoformat()
        local = cast(datetime, self._local_time(value))
        return f"{self.format_date(local.date())}, {self.format_time(local)}"

    def _local_time(self: Any, value: datetime) -> datetime:
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(ZoneInfo(self.runtime.config.preferences.time_zone))

    def _task_rows(self: Any, tasks: tuple[Task, ...]) -> list[tuple[Task, str]]:
        children: dict[str | None, list[Task]] = {}
        for task in tasks:
            children.setdefault(task.parent_id, []).append(task)
        rows: list[tuple[Task, str]] = []
        seen: set[str] = set()

        def visit(task: Task, depth: int) -> None:
            if task.id in seen:
                return
            seen.add(task.id)
            rows.append((task, "  " * depth))
            for child in children.get(task.id, []):
                visit(child, depth + 1)

        for root in children.get(None, []):
            visit(root, 0)
        for task in tasks:
            visit(task, 0)
        return rows

    def _render_surface(self: Any) -> None:
        selection = self._selection_summary()
        self.query_one("#surface-title", Static).update(
            f"{self.surface}  ·  {self.selected_date:%A, %d %B %Y}{selection}"
        )
        content = self.query_one("#content", ListView)
        content.clear()
        if self.surface in {"Tasks", "Notes"}:
            tasks = self.cache.tasks
            if self.resource_filter and self.resource_filter[0] == "task-list":
                tasks = tuple(task for task in tasks if task.list_id == self.resource_filter[1])
            projection = (
                self.runtime.application.notes_projection(self.account_id)
                if self.account_id
                else None
            )
            if self.surface == "Notes":
                tasks = (
                    tuple(task for task in tasks if task.due is None and task.parent_id is None)
                    if projection is not None and projection.value != "disabled"
                    else ()
                )
            elif projection is not None and projection.value == "notes-only":
                tasks = tuple(
                    task for task in tasks if task.due is not None or task.parent_id is not None
                )
            for task, indent in self._task_rows(tasks):
                marked = "*" if task.id in self.marked else " "
                status = "✓" if task.status is TaskStatus.COMPLETED else "·"
                due = f"  {self.format_date(task.due)}" if task.due else ""
                note_lines = (task.notes or "").splitlines()
                notes = f" — {note_lines[0]}" if self.surface == "Notes" and note_lines else ""
                content.append(
                    EntityRow(
                        f"{marked} {indent}{status} {task.title}{due}{notes}",
                        kind="task",
                        item_id=task.id,
                    )
                )
        else:
            events = self._events_for_surface()
            for event in events:
                when = self.format_date_time(event.start.value)
                marked = "*" if event.id in self.marked_events else " "
                content.append(
                    EntityRow(
                        f"{marked} {when}  {event.summary}",
                        kind="event",
                        item_id=event.id,
                    )
                )
            if self.surface == "Month" and not events:
                content.append(EntityRow("No events this month", kind="empty", item_id="month"))
        if not content.children:
            content.append(
                EntityRow(
                    f"No {self.surface.lower()} in the local cache",
                    kind="empty",
                    item_id="empty",
                )
            )
        content.index = 0
        self._update_content_selection()

    def _selection_summary(self: Any) -> str:
        parts: list[str] = []
        if self.marked:
            parts.append(f"{len(self.marked)} task(s)")
        if self.marked_events:
            parts.append(f"{len(self.marked_events)} event(s)")
        return f"  ·  selected: {', '.join(parts)}" if parts else ""

    def _update_content_selection(self: Any) -> None:
        """Keep the active workspace row visibly selected."""
        content = self.query_one("#content", ListView)
        for row in content.query(EntityRow):
            row.set_class((row.kind, row.item_id) == self.selected, "hcb-selected")

    def _update_resource_selection(self: Any) -> None:
        """Keep the active resource visible after focus moves to another pane."""
        resources = self.query_one("#resources", ListView)
        for row in resources.query(EntityRow):
            selected = (
                row.kind == "resource-all"
                if self.resource_filter is None
                else (row.kind, row.item_id) == self.resource_filter
            )
            row.set_class(selected, "hcb-selected")

    def _event_surface_range(self: Any) -> tuple[date, date]:
        day = self.selected_date
        if self.surface == "Day":
            return day, day + timedelta(days=1)
        if self.surface == "Week":
            offset = (day.weekday() - self.runtime.config.preferences.week_starts_on) % 7
            start = day - timedelta(days=offset)
            return start, start + timedelta(days=7)
        if self.surface == "Month":
            start = day.replace(day=1)
            return start, (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        return day, day + timedelta(days=14)

    def _instance_cache_badge(self: Any) -> str | None:
        """Summarize the local-only occurrence-cache state for the visible range."""
        if self.account_id is None or self.surface in {"Tasks", "Notes"}:
            return None
        start, end = self._event_surface_range()
        calendar_ids = (
            (self.resource_filter[1],)
            if self.resource_filter and self.resource_filter[0] == "calendar"
            else tuple(item_id for item_id, _title, selected in self.cache.calendars if selected)
        )
        if not calendar_ids:
            return "instances: missing"
        statuses = [
            self.runtime.storage.instance_cache_status(self.account_id, item_id, start, end)
            for item_id in calendar_ids
        ]
        states = {item["state"] for item in statuses}
        state = (
            "fresh"
            if states == {"fresh"}
            else "partial"
            if "fresh" in states
            else ("stale" if "stale" in states else "missing")
        )
        ranges = [item for status in statuses for item in status["ranges"]]
        refreshed = max(
            (str(item["refreshed_at"]) for item in ranges if item.get("refreshed_at")),
            default=None,
        )
        stale_reason = next(
            (str(item["stale_reason"]) for item in ranges if item.get("state") == "stale"),
            None,
        )
        details = f"{self.format_date(start)}–{self.format_date(end)}"
        if refreshed:
            details += f", refreshed {self.format_date_time(datetime.fromisoformat(refreshed))}"
        if stale_reason:
            details += f", {stale_reason.replace('-', ' ')}"
        return f"instances: {state} ({details})"

    def _events_for_surface(self: Any) -> tuple[Event, ...]:
        start, end = self._event_surface_range()
        events = tuple(
            event
            for event in self.cache.events
            if self._event_overlaps_range(event, start, end)
            if (
                not self.resource_filter
                or self.resource_filter[0] != "calendar"
                or event.calendar_id == self.resource_filter[1]
            )
        )
        expanded_series = {
            event.canonical_id for event in events if event.derived and event.canonical_id
        }
        return tuple(
            event
            for event in events
            if event.derived or not event.recurrence or event.remote_id not in expanded_series
        )

    def _event_overlaps_range(self: Any, event: Event, start: date, end: date) -> bool:
        """Use instant boundaries for timed events and exclusive ones for all-day dates."""
        event_start = event.start.value
        event_end = event.end.value
        if not isinstance(event_start, datetime) and not isinstance(event_end, datetime):
            return event_end > start and event_start < end
        if not isinstance(event_start, datetime) or not isinstance(event_end, datetime):
            return False
        zone = ZoneInfo(self.runtime.config.preferences.time_zone)
        range_start = datetime.combine(start, datetime.min.time(), tzinfo=zone)
        range_end = datetime.combine(end, datetime.min.time(), tzinfo=zone)
        return bool(
            self._local_time(event_end) > range_start and self._local_time(event_start) < range_end
        )

    def on_button_pressed(self: Any, event: Button.Pressed) -> None:
        button_id = event.button.id
        if button_id in self._mini_month_days:
            self._select_date(self._mini_month_days[button_id])
        elif button_id and button_id.startswith("surface-"):
            self.action_surface(button_id.removeprefix("surface-").title())

    def on_list_view_highlighted(self: Any, event: ListView.Highlighted) -> None:
        if event.list_view.id != "content" or not isinstance(event.item, EntityRow):
            return
        row = event.item
        self.selected = (row.kind, row.item_id)
        self._update_content_selection()

    def on_list_view_selected(self: Any, event: ListView.Selected) -> None:
        if not isinstance(event.item, EntityRow):
            return
        row = event.item
        if event.list_view.id == "content":
            self.selected = (row.kind, row.item_id)
            self._update_content_selection()
            if row.kind in {"task", "event"}:
                self.action_view()
            return
        if event.list_view.id != "resources":
            return
        self.resource_filter = None if row.kind == "resource-all" else (row.kind, row.item_id)
        self._render_chrome(refresh_resources=False)
        self._render_surface()

    def _selected_task(self: Any) -> Task | None:
        if not self.selected or self.selected[0] != "task":
            return None
        return next((item for item in self.cache.tasks if item.id == self.selected[1]), None)

    def _selected_event(self: Any) -> Event | None:
        if not self.selected or self.selected[0] != "event":
            return None
        return next((item for item in self.cache.events if item.id == self.selected[1]), None)

    def _selected_drive(self: Any) -> DriveFile | None:
        if not self.selected or self.selected[0] != "drive" or self.account_id is None:
            return None
        return cast(
            DriveFile | None,
            self.runtime.storage.get_drive_file(self.account_id, self.selected[1]),
        )

    def search_local(self: Any, query: str) -> tuple[SearchResult, ...]:
        if self.account_id is None:
            return ()
        return cast(
            tuple[SearchResult, ...], self.runtime.application.search(self.account_id, query)
        )
