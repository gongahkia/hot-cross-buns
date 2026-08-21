"""Textual workspace for the local-first HCB application."""

from __future__ import annotations

import calendar
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import ClassVar, cast

from rich.text import Text
from textual import events, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen
from textual.theme import Theme as TextualTheme
from textual.widgets import (
    Button,
    Footer,
    Input,
    Label,
    ListItem,
    ListView,
    Static,
    TextArea,
)

from .application import ResponseStatus, SearchResult, TimeSlot
from .errors import AuthenticationRequired, HcbError
from .models import DateTimeKind, Event, EventDateTime, Task, TaskStatus
from .runtime import Runtime

SURFACES = ("Tasks", "Notes", "Agenda", "Day", "Week", "Month")
PALETTE_COMMANDS = (
    ("Create item", "create"),
    ("Sync now", "sync"),
    ("Find a time", "find-time"),
    ("Calendars", "calendars"),
    ("Settings", "settings"),
    ("Doctor", "doctor"),
)


@dataclass(frozen=True, slots=True)
class CachedWorkspace:
    identity: str = ""
    tasks: tuple[Task, ...] = ()
    events: tuple[Event, ...] = ()
    task_lists: tuple[tuple[str, str], ...] = ()
    calendars: tuple[tuple[str, str, bool], ...] = ()
    pending: int = 0


class EntityRow(ListItem):
    """A selectable row carrying a domain identity."""

    def __init__(self, label: str, *, kind: str, item_id: str, action: str | None = None) -> None:
        super().__init__(Label(label, markup=False))
        self.kind = kind
        self.item_id = item_id
        self.palette_action = action


class EditorScreen(ModalScreen[dict[str, str] | None]):
    """Keyboard-first task editor and date-jump prompt."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(
        self,
        *,
        title: str = "",
        notes: str = "",
        due: str = "",
        jump: bool = False,
    ) -> None:
        super().__init__()
        self.initial_title = title
        self.initial_notes = notes
        self.initial_due = due
        self.jump = jump

    def compose(self) -> ComposeResult:
        with Vertical(id="editor-dialog"):
            yield Label("Jump to date" if self.jump else "Task editor", id="dialog-title")
            yield Input(
                value=self.initial_due if self.jump else self.initial_title,
                placeholder="YYYY-MM-DD" if self.jump else "Task title",
                id="editor-title",
            )
            if not self.jump:
                yield Input(
                    value=self.initial_due,
                    placeholder="Due date (YYYY-MM-DD)",
                    id="editor-due",
                )
                yield TextArea(self.initial_notes, id="editor-notes")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Go" if self.jump else "Save", variant="primary", id="save")
                yield Button("Cancel", id="cancel")

    def on_mount(self) -> None:
        self.query_one("#editor-title", Input).focus()

    def action_cancel(self) -> None:
        self.dismiss(None)

    def _result(self) -> dict[str, str]:
        if self.jump:
            return {"date": self.query_one("#editor-title", Input).value.strip()}
        return {
            "title": self.query_one("#editor-title", Input).value.strip(),
            "due": self.query_one("#editor-due", Input).value.strip(),
            "notes": self.query_one("#editor-notes", TextArea).text,
        }

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if self.jump or event.input.id == "editor-due":
            self.dismiss(self._result())

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(self._result() if event.button.id == "save" else None)


class ConfirmScreen(ModalScreen[bool]):
    BINDINGS = [
        Binding("escape", "cancel", "Cancel"),
        Binding("y", "confirm", "Confirm"),
        Binding("n", "cancel", "Cancel"),
    ]

    def __init__(self, message: str) -> None:
        super().__init__()
        self.message = message

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm-dialog"):
            yield Label(self.message, markup=False)
            with Horizontal(classes="dialog-buttons"):
                yield Button("Delete", variant="error", id="confirm")
                yield Button("Cancel", id="cancel")

    def action_confirm(self) -> None:
        self.dismiss(True)

    def action_cancel(self) -> None:
        self.dismiss(False)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "confirm")


class EventEditorScreen(ModalScreen[dict[str, str] | None]):
    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, event: Event | None, calendar_id: str) -> None:
        super().__init__()
        self.event = event
        self.calendar_id = event.calendar_id if event else calendar_id

    def compose(self) -> ComposeResult:
        event = self.event
        with Vertical(id="event-dialog"):
            yield Label("Event editor", id="dialog-title")
            yield Input(value=event.summary if event else "", placeholder="Title", id="event-title")
            yield Input(
                value=event.start.value.isoformat() if event else "",
                placeholder="Start: YYYY-MM-DD or YYYY-MM-DDTHH:MM",
                id="event-start",
            )
            yield Input(
                value=event.end.value.isoformat() if event else "",
                placeholder="End: YYYY-MM-DD or YYYY-MM-DDTHH:MM",
                id="event-end",
            )
            yield Input(value=self.calendar_id, placeholder="Calendar id", id="event-calendar")
            yield Input(
                value=event.location or "" if event else "",
                placeholder="Location",
                id="event-location",
            )
            yield TextArea(event.description or "" if event else "", id="event-description")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Save", variant="primary", id="event-save")
                yield Button("Cancel", id="event-cancel")

    def on_mount(self) -> None:
        self.query_one("#event-title", Input).focus()

    def action_cancel(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id != "event-save":
            self.dismiss(None)
            return
        self.dismiss(
            {
                "title": self.query_one("#event-title", Input).value.strip(),
                "start": self.query_one("#event-start", Input).value.strip(),
                "end": self.query_one("#event-end", Input).value.strip(),
                "calendar": self.query_one("#event-calendar", Input).value.strip(),
                "location": self.query_one("#event-location", Input).value.strip(),
                "description": self.query_one("#event-description", TextArea).text,
            }
        )


class RsvpScreen(ModalScreen[str | None]):
    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def compose(self) -> ComposeResult:
        with Vertical(id="rsvp-dialog"):
            yield Label("RSVP response", id="dialog-title")
            yield Button("Accept", id="accepted")
            yield Button("Tentative", id="tentative")
            yield Button("Decline", id="declined")
            yield Button("Needs action", id="needsAction")
            yield Button("Cancel", id="cancel")

    def action_cancel(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(None if event.button.id == "cancel" else event.button.id)


class CalendarScreen(ModalScreen[None]):
    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, hcb: HcbApp) -> None:
        super().__init__()
        self.hcb = hcb
        self.selected_id: str | None = None

    def compose(self) -> ComposeResult:
        with Vertical(id="calendar-dialog"):
            yield Label("Calendars", id="dialog-title")
            yield ListView(id="calendar-list")
            yield Input(placeholder="New calendar name", id="calendar-name")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Add", variant="primary", id="calendar-add")
                yield Button("Toggle", id="calendar-toggle")
                yield Button("Delete", variant="error", id="calendar-delete")
                yield Button("Close", id="calendar-close")

    def on_mount(self) -> None:
        self.refresh_list()

    def refresh_list(self) -> None:
        view = self.query_one("#calendar-list", ListView)
        view.clear()
        for calendar_id, summary, selected in self.hcb.calendar_rows():
            marker = "x" if selected else " "
            view.append(
                EntityRow(
                    f"[{marker}] {summary}",
                    kind="calendar",
                    item_id=calendar_id,
                )
            )
        if view.children:
            view.index = 0

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        if isinstance(event.item, EntityRow):
            self.selected_id = event.item.item_id

    def on_button_pressed(self, event: Button.Pressed) -> None:
        action = event.button.id
        if action == "calendar-close":
            self.dismiss(None)
        elif action == "calendar-add":
            name = self.query_one("#calendar-name", Input).value.strip()
            if name and self.hcb.create_calendar(name):
                self.query_one("#calendar-name", Input).value = ""
                self.refresh_list()
        elif action == "calendar-toggle" and self.selected_id:
            self.hcb.toggle_calendar(self.selected_id)
            self.refresh_list()
        elif action == "calendar-delete" and self.selected_id:
            self.hcb.confirm_calendar_delete(self.selected_id, self.refresh_list)

    def action_close(self) -> None:
        self.dismiss(None)


class SettingsScreen(ModalScreen[dict[str, str] | None]):
    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, hcb: HcbApp) -> None:
        super().__init__()
        self.hcb = hcb

    def compose(self) -> ComposeResult:
        values = self.hcb.settings_values()
        with Vertical(id="settings-dialog"):
            yield Label("Settings", id="dialog-title")
            yield Input(value=values["theme"], placeholder="dark/light/mono", id="setting-theme")
            yield Input(
                value=values["density"],
                placeholder="compact/comfortable",
                id="setting-density",
            )
            yield Input(value=values["borders"], placeholder="unicode/ascii", id="setting-borders")
            yield Input(value=values["mouse"], placeholder="true/false", id="setting-mouse")
            yield Input(
                value=values["week_starts_on"],
                placeholder="Week starts on: 0-6",
                id="setting-week",
            )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Save", variant="primary", id="settings-save")
                yield Button("Cancel", id="settings-cancel")

    def action_cancel(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id != "settings-save":
            self.dismiss(None)
            return
        self.dismiss(
            {
                "theme": self.query_one("#setting-theme", Input).value.strip(),
                "density": self.query_one("#setting-density", Input).value.strip(),
                "borders": self.query_one("#setting-borders", Input).value.strip(),
                "mouse": self.query_one("#setting-mouse", Input).value.strip(),
                "week_starts_on": self.query_one("#setting-week", Input).value.strip(),
            }
        )


class FindTimeScreen(ModalScreen[None]):
    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, hcb: HcbApp) -> None:
        super().__init__()
        self.hcb = hcb

    def compose(self) -> ComposeResult:
        with Vertical(id="find-time-dialog"):
            yield Label("Find time · local cached events", id="dialog-title")
            yield Input(value=self.hcb.selected_date.isoformat(), id="find-date")
            yield Input(value="30", placeholder="Duration minutes", id="find-duration")
            yield Input(value="9", placeholder="Day starts (hour)", id="find-start")
            yield Input(value="17", placeholder="Day ends (hour)", id="find-end")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Find local slots", variant="primary", id="find-local")
                yield Button("Close", id="find-close")
            yield Static(
                "Remote freebusy is never queried here; use explicit sync separately.",
                id="find-disclosure",
            )
            yield ListView(id="find-results")

    def on_mount(self) -> None:
        self.calculate()

    def calculate(self) -> None:
        try:
            slots = self.hcb.find_time_local(
                self.query_one("#find-date", Input).value,
                self.query_one("#find-duration", Input).value,
                self.query_one("#find-start", Input).value,
                self.query_one("#find-end", Input).value,
            )
        except ValueError as exc:
            self.hcb.notify(str(exc), severity="error")
            return
        view = self.query_one("#find-results", ListView)
        view.clear()
        for slot in slots:
            view.append(
                EntityRow(
                    f"{slot.start:%H:%M}–{slot.end:%H:%M}",
                    kind="time-slot",
                    item_id=slot.start.isoformat(),
                )
            )
        if not slots:
            view.append(EntityRow("No local slots available", kind="empty", item_id="none"))

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "find-local":
            self.calculate()
        else:
            self.dismiss(None)

    def action_close(self) -> None:
        self.dismiss(None)


class PaletteScreen(ModalScreen[tuple[str, str] | None]):
    """Command palette with commands first and title-first local results."""

    BINDINGS = [Binding("escape", "cancel", "Close")]

    def __init__(self, app_service: HcbApp) -> None:
        super().__init__()
        self.hcb = app_service

    def compose(self) -> ComposeResult:
        with Vertical(id="palette-dialog"):
            yield Input(placeholder="Type a command or search local data", id="palette-query")
            yield ListView(id="palette-results")

    def on_mount(self) -> None:
        self.query_one(Input).focus()
        self._fill("")

    def _fill(self, query: str) -> None:
        view = self.query_one(ListView)
        view.clear()
        needle = query.casefold().strip()
        for title, action in PALETTE_COMMANDS:
            if not needle or needle in title.casefold():
                view.append(EntityRow(title, kind="command", item_id=action, action=action))
        if needle and self.hcb.account_id:
            for result in self.hcb.search_local(query):
                item = result.item
                title = item.title if isinstance(item, Task) else getattr(item, "summary", "")
                view.append(
                    EntityRow(
                        f"{title}  · {result.kind}",
                        kind=result.kind,
                        item_id=item.id,
                    )
                )
        if view.children:
            view.index = 0

    def on_input_changed(self, event: Input.Changed) -> None:
        self._fill(event.value)

    def on_input_submitted(self, _: Input.Submitted) -> None:
        self._choose()

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        row = event.item
        if isinstance(row, EntityRow):
            self.dismiss((row.palette_action or row.kind, row.item_id))

    def _choose(self) -> None:
        view = self.query_one(ListView)
        row = view.highlighted_child
        if isinstance(row, EntityRow):
            self.dismiss((row.palette_action or row.kind, row.item_id))

    def action_cancel(self) -> None:
        self.dismiss(None)


class HcbApp(App[None]):
    """Configurable, cached terminal workspace."""

    CSS_PATH = "tui.tcss"
    TITLE = "Hot Cross Buns"
    SUB_TITLE = "local-first tasks and calendar"
    BINDINGS: ClassVar[list[Binding | tuple[str, str] | tuple[str, str, str]]] = [
        Binding("q", "quit", "Quit"),
        Binding("/", "palette", "Command"),
        Binding("ctrl+p", "palette", "Command"),
        Binding("n", "create", "New"),
        Binding("e", "edit", "Edit"),
        Binding("space", "complete", "Complete"),
        Binding("d", "delete", "Delete"),
        Binding("r", "sync", "Sync"),
        Binding("g", "jump", "Date"),
        Binding("x", "mark", "Mark"),
        Binding("v", "rsvp", "RSVP"),
        Binding("1", "surface('Tasks')", "Tasks", show=False),
        Binding("2", "surface('Notes')", "Notes", show=False),
        Binding("3", "surface('Agenda')", "Agenda", show=False),
        Binding("4", "surface('Day')", "Day", show=False),
        Binding("5", "surface('Week')", "Week", show=False),
        Binding("6", "surface('Month')", "Month", show=False),
    ]

    def __init__(
        self,
        runtime: Runtime | None = None,
        *,
        account: str | None = None,
        selected_date: date | None = None,
    ) -> None:
        super().__init__()
        self.runtime = runtime or Runtime()
        self.explicit_account = account
        self.account_id: str | None = None
        self.selected_date = selected_date or date.today()
        self.surface = "Tasks"
        self.cache = CachedWorkspace()
        self.selected: tuple[str, str] | None = None
        self.resource_filter: tuple[str, str] | None = None
        self.marked: set[str] = set()
        self.syncing = False
        config = self.runtime.config
        forced_mono = (
            self.runtime.environ.get("NO_COLOR") is not None
            or self.runtime.environ.get("TERM") == "dumb"
        )
        configured = (
            config.theme.name if config.theme.name != "system" else config.preferences.theme
        )
        self.theme_mode = "mono" if forced_mono else configured
        if self.theme_mode not in {"dark", "light", "mono"}:
            self.theme_mode = "dark"
        self.density = config.theme.density
        self.border_style = "ascii" if forced_mono else config.theme.borders
        self.mouse_enabled = config.theme.mouse and not forced_mono

    def compose(self) -> ComposeResult:
        yield Static(id="topbar")
        yield Horizontal(
            *[Button(name, id=f"surface-{name.lower()}") for name in SURFACES],
            id="tabs",
        )
        with Horizontal(id="workspace"):
            with Vertical(id="sidebar"):
                yield Static(id="mini-month")
                yield Static("Resources", classes="section-title")
                yield ListView(id="resources")
                yield Static(id="sync-state")
            with Vertical(id="center"):
                yield Static(id="surface-title")
                yield ListView(id="content")
            with Vertical(id="inspector"):
                yield Static("Inspector", classes="section-title")
                yield Static("Select an item", id="inspection")
        yield Footer()

    def on_mount(self) -> None:
        configured_theme = self.runtime.config.theme
        self.register_theme(
            TextualTheme(
                name="hcb-config",
                primary=configured_theme.accent,
                accent=configured_theme.accent,
                success=configured_theme.success,
                warning=configured_theme.warning,
                error=configured_theme.danger,
                dark=self.theme_mode != "light",
                variables={"text-muted": configured_theme.muted},
            )
        )
        self.theme = "hcb-config"
        self.add_class(f"theme-{self.theme_mode}", f"density-{self.density}")
        if self.border_style == "ascii":
            self.add_class("ascii")
        if not self.mouse_enabled:
            self.add_class("no-mouse")
        self.dark = self.theme_mode != "light"
        self._bind_configured_keys()
        try:
            self.account_id = self.runtime.account_id(self.explicit_account)
        except AuthenticationRequired:
            self.account_id = None
        self.refresh_workspace()

    def _bind_configured_keys(self) -> None:
        keys = self.runtime.config.keys
        for key, action in (
            (keys.quit, "quit"),
            (keys.search, "palette"),
            (keys.sync, "sync"),
            (keys.create, "create"),
            (keys.edit, "edit"),
            (keys.delete, "delete"),
            (keys.complete, "complete"),
        ):
            self.bind(key, action)

    def on_unmount(self) -> None:
        self.runtime.close()

    def on_mouse_down(self, event: events.MouseDown) -> None:
        if not self.mouse_enabled:
            event.stop()
            event.prevent_default()

    def on_resize(self, event: events.Resize) -> None:
        self.set_class(event.size.width < 90, "narrow")
        self.set_class(event.size.width < 62, "very-narrow")

    def refresh_workspace(self) -> None:
        """Refresh the UI cache through the application controller boundary."""
        if self.account_id is None:
            self.cache = CachedWorkspace()
            self._render_onboarding()
            return
        snapshot = self.runtime.application.workspace(self.account_id)
        self.cache = CachedWorkspace(
            identity=snapshot.account.email,
            tasks=snapshot.tasks,
            events=snapshot.events,
            task_lists=tuple((item.id, item.title) for item in snapshot.task_lists),
            calendars=tuple((item.id, item.summary, item.selected) for item in snapshot.calendars),
            pending=snapshot.pending,
        )
        self._render_chrome()
        self._render_surface()

    def _render_onboarding(self) -> None:
        self.query_one("#topbar", Static).update("HCB  ·  offline workspace")
        self.query_one("#mini-month", Static).update(self._month_text())
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
        self.query_one("#inspection", Static).update(
            "HCB will not contact Google until you explicitly connect and run sync."
        )

    def _render_chrome(self) -> None:
        self.query_one("#topbar", Static).update(
            f"HCB  ·  {self.cache.identity}  ·  {self.selected_date.isoformat()}"
            "  ·  / command palette"
        )
        self.query_one("#mini-month", Static).update(self._month_text())
        resources = self.query_one("#resources", ListView)
        resources.clear()
        resources.append(EntityRow("All resources", kind="resource-all", item_id="all"))
        for item_id, title in self.cache.task_lists:
            resources.append(EntityRow(f"☐ {title}", kind="task-list", item_id=item_id))
        for item_id, title, _ in self.cache.calendars:
            resources.append(EntityRow(f"□ {title}", kind="calendar", item_id=item_id))
        state = "syncing…" if self.syncing else "offline cache"
        self.query_one("#sync-state", Static).update(f"{state} · {self.cache.pending} pending")

    def _month_text(self) -> Text:
        cal = calendar.TextCalendar(self.runtime.config.preferences.week_starts_on)
        value = cal.formatmonth(self.selected_date.year, self.selected_date.month, w=2, l=1)
        if self.border_style == "ascii":
            return Text(value)
        return Text(value.replace(" ", " "))

    def _task_rows(self, tasks: tuple[Task, ...]) -> list[tuple[Task, str]]:
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

    def _render_surface(self) -> None:
        self.query_one("#surface-title", Static).update(
            f"{self.surface}  ·  {self.selected_date:%A, %d %B %Y}"
        )
        content = self.query_one("#content", ListView)
        content.clear()
        if self.surface in {"Tasks", "Notes"}:
            tasks = self.cache.tasks
            if self.resource_filter and self.resource_filter[0] == "task-list":
                tasks = tuple(task for task in tasks if task.list_id == self.resource_filter[1])
            if self.surface == "Notes":
                tasks = tuple(task for task in tasks if task.notes)
            for task, indent in self._task_rows(tasks):
                marked = "*" if task.id in self.marked else " "
                status = "✓" if task.status is TaskStatus.COMPLETED else "·"
                due = f"  {task.due.isoformat()}" if task.due else ""
                notes = (
                    f" — {(task.notes or '').splitlines()[0]}" if self.surface == "Notes" else ""
                )
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
                when = event.start.value.isoformat()
                content.append(
                    EntityRow(
                        f"{when}  {event.summary}",
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

    @staticmethod
    def _event_day(value: date | datetime) -> date:
        return value.date() if isinstance(value, datetime) else value

    def _events_for_surface(self) -> tuple[Event, ...]:
        day = self.selected_date
        if self.surface == "Day":
            start, end = day, day + timedelta(days=1)
        elif self.surface == "Week":
            offset = (day.weekday() - self.runtime.config.preferences.week_starts_on) % 7
            start = day - timedelta(days=offset)
            end = start + timedelta(days=7)
        elif self.surface == "Month":
            start = day.replace(day=1)
            end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        else:
            start, end = day, day + timedelta(days=14)
        return tuple(
            event
            for event in self.cache.events
            if self._event_day(event.end.value) > start and self._event_day(event.start.value) < end
            if (
                not self.resource_filter
                or self.resource_filter[0] != "calendar"
                or event.calendar_id == self.resource_filter[1]
            )
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id and event.button.id.startswith("surface-"):
            self.action_surface(event.button.id.removeprefix("surface-").title())

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        if event.list_view.id != "content" or not isinstance(event.item, EntityRow):
            return
        row = event.item
        self.selected = (row.kind, row.item_id)
        self._render_inspector()

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        if event.list_view.id != "resources" or not isinstance(event.item, EntityRow):
            return
        row = event.item
        self.resource_filter = None if row.kind == "resource-all" else (row.kind, row.item_id)
        self._render_surface()

    def _render_inspector(self) -> None:
        target = self._selected_task()
        if target:
            self.query_one("#inspection", Static).update(
                Text(
                    f"{target.title}\n\nStatus: {target.status.value}\n"
                    f"Due: {target.due or '—'}\nPriority: {target.priority.value}\n\n"
                    f"{target.notes or 'No notes'}"
                )
            )
            return
        event = self._selected_event()
        if event:
            self.query_one("#inspection", Static).update(
                Text(
                    f"{event.summary}\n\n{event.start.value.isoformat()} → "
                    f"{event.end.value.isoformat()}\n{event.location or ''}\n\n"
                    f"{event.description or 'No description'}"
                )
            )

    def _selected_task(self) -> Task | None:
        if not self.selected or self.selected[0] != "task":
            return None
        return next((item for item in self.cache.tasks if item.id == self.selected[1]), None)

    def _selected_event(self) -> Event | None:
        if not self.selected or self.selected[0] != "event":
            return None
        return next((item for item in self.cache.events if item.id == self.selected[1]), None)

    def search_local(self, query: str) -> tuple[SearchResult, ...]:
        if self.account_id is None:
            return ()
        return self.runtime.application.search(self.account_id, query)

    def action_surface(self, name: str) -> None:
        if name not in SURFACES:
            return
        self.surface = name
        self.selected = None
        self._render_surface()

    def action_palette(self) -> None:
        self.push_screen(PaletteScreen(self), self._palette_result)

    def _palette_result(self, result: tuple[str, str] | None) -> None:
        if result is None:
            return
        kind, value = result
        if kind == "create":
            self.action_create()
        elif kind == "sync":
            self.action_sync()
        elif kind == "calendars":
            self.push_screen(CalendarScreen(self))
        elif kind == "doctor":
            diagnostics = self.runtime.application.diagnostics()
            self.notify(
                f"Database {diagnostics['integrity']}; {diagnostics['pending_mutations']} pending"
            )
        elif kind == "settings":
            self.push_screen(SettingsScreen(self), self._settings_result)
        elif kind == "find-time":
            self.push_screen(FindTimeScreen(self))
        elif kind in {"task", "event"}:
            self.surface = "Tasks" if kind == "task" else "Agenda"
            self.selected = (kind, value)
            self._render_surface()
            self._render_inspector()

    def action_create(self) -> None:
        if self.account_id is None:
            self.notify(
                "Connect an account first: hcb auth connect ACCOUNT EMAIL",
                severity="warning",
            )
            return
        if self.surface not in {"Tasks", "Notes"}:
            if not self.cache.calendars:
                self.notify("Create a calendar first", severity="warning")
                return
            self.push_screen(
                EventEditorScreen(None, self.cache.calendars[0][0]),
                self._event_create_result,
            )
        else:
            if not self.cache.task_lists:
                self.notify(
                    "Create a task list first: hcb task-lists create Inbox",
                    severity="warning",
                )
                return
            self.push_screen(EditorScreen(), self._create_result)

    def _create_result(self, result: dict[str, str] | None) -> None:
        if not result or not result["title"] or self.account_id is None:
            return
        try:
            self.runtime.application.create_task(
                self.account_id,
                self.cache.task_lists[0][0],
                result["title"],
                due=date.fromisoformat(result["due"]) if result["due"] else None,
                notes=result["notes"] or None,
            )
        except ValueError as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Task created")

    def action_edit(self) -> None:
        task = self._selected_task()
        event = self._selected_event()
        if event is not None:
            self.push_screen(EventEditorScreen(event, event.calendar_id), self._event_edit_result)
            return
        if task is None:
            self.notify("Select a task or event to edit", severity="warning")
            return
        self.push_screen(
            EditorScreen(
                title=task.title,
                notes=task.notes or "",
                due=task.due.isoformat() if task.due else "",
            ),
            self._edit_result,
        )

    def _edit_result(self, result: dict[str, str] | None) -> None:
        task = self._selected_task()
        if not result or not result["title"] or task is None or self.account_id is None:
            return
        try:
            self.runtime.application.update_task(
                self.account_id,
                task.id,
                title=result["title"],
                notes=result["notes"] or None,
                due=date.fromisoformat(result["due"]) if result["due"] else None,
                clear_due=not result["due"],
            )
        except ValueError as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Task updated")

    @staticmethod
    def _parse_event_point(raw: str) -> EventDateTime:
        if "T" not in raw and " " not in raw:
            return EventDateTime(DateTimeKind.DATE, date.fromisoformat(raw))
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return EventDateTime(DateTimeKind.DATETIME, value, "UTC")

    def _event_create_result(self, result: dict[str, str] | None) -> None:
        if not result or not result["title"] or self.account_id is None:
            return
        try:
            self.runtime.application.create_event(
                self.account_id,
                result["calendar"],
                result["title"],
                self._parse_event_point(result["start"]),
                self._parse_event_point(result["end"]),
                description=result["description"] or None,
                location=result["location"] or None,
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Event created")

    def _event_edit_result(self, result: dict[str, str] | None) -> None:
        event = self._selected_event()
        if not result or not result["title"] or event is None or self.account_id is None:
            return
        try:
            if result["calendar"] != event.calendar_id:
                self.runtime.application.move_event(self.account_id, event.id, result["calendar"])
            self.runtime.application.update_event(
                self.account_id,
                event.id,
                summary=result["title"],
                start=self._parse_event_point(result["start"]),
                end=self._parse_event_point(result["end"]),
                description=result["description"] or None,
                location=result["location"] or None,
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Event updated")

    def action_rsvp(self) -> None:
        if self._selected_event() is None:
            self.notify("Select an event to RSVP", severity="warning")
            return
        self.push_screen(RsvpScreen(), self._rsvp_result)

    def _rsvp_result(self, response: str | None) -> None:
        event = self._selected_event()
        if response is None or event is None or self.account_id is None:
            return
        self.runtime.application.respond_event(
            self.account_id, event.id, cast(ResponseStatus, response)
        )
        self.refresh_workspace()
        self.notify(f"RSVP {response} queued")

    def action_complete(self) -> None:
        if self.account_id is None:
            return
        task = self._selected_task()
        ids = set(self.marked) or ({task.id} if task else set())
        if not ids:
            self.notify("Select a task to complete", severity="warning")
            return
        for task_id in ids:
            item = next(
                (candidate for candidate in self.cache.tasks if candidate.id == task_id),
                None,
            )
            if item:
                self.runtime.application.complete_task(
                    self.account_id,
                    task_id,
                    completed=item.status is not TaskStatus.COMPLETED,
                )
        self.marked.clear()
        self.refresh_workspace()
        self.notify(f"Updated {len(ids)} task(s)")

    def action_mark(self) -> None:
        task = self._selected_task()
        if task is None:
            return
        if task.id in self.marked:
            self.marked.remove(task.id)
        else:
            self.marked.add(task.id)
        self._render_surface()

    def action_delete(self) -> None:
        task = self._selected_task()
        event = self._selected_event()
        ids = set(self.marked)
        if not ids and task:
            ids.add(task.id)
        if not ids and event is None:
            self.notify("Select an item to delete", severity="warning")
            return
        count = len(ids) or 1
        self.push_screen(
            ConfirmScreen(f"Delete {count} selected item(s)?"),
            self._delete_result,
        )

    def _delete_result(self, confirmed: bool | None) -> None:
        if not confirmed or self.account_id is None:
            return
        event = self._selected_event()
        ids = set(self.marked)
        task = self._selected_task()
        if not ids and task:
            ids.add(task.id)
        for task_id in ids:
            self.runtime.application.delete_task(self.account_id, task_id)
        if event and not ids:
            self.runtime.application.delete_event(self.account_id, event.id)
        self.marked.clear()
        self.selected = None
        self.refresh_workspace()
        self.notify("Deleted")

    def calendar_rows(self) -> tuple[tuple[str, str, bool], ...]:
        return self.cache.calendars

    def create_calendar(self, name: str) -> bool:
        if self.account_id is None:
            return False
        try:
            self.runtime.application.create_calendar(self.account_id, name)
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return False
        self.refresh_workspace()
        self.notify("Calendar created")
        return True

    def toggle_calendar(self, calendar_id: str) -> None:
        if self.account_id is None:
            return
        selected = next(
            (enabled for item_id, _, enabled in self.cache.calendars if item_id == calendar_id),
            True,
        )
        self.runtime.application.update_calendar(
            self.account_id, calendar_id, selected=not selected
        )
        self.refresh_workspace()

    def confirm_calendar_delete(self, calendar_id: str, callback: Callable[[], None]) -> None:
        def apply(confirmed: bool | None) -> None:
            if confirmed and self.account_id is not None:
                self.runtime.application.delete_calendar(self.account_id, calendar_id)
                self.refresh_workspace()
                callback()
                self.notify("Calendar deleted")

        self.push_screen(ConfirmScreen("Delete this calendar and its cached events?"), apply)

    def settings_values(self) -> dict[str, str]:
        config = self.runtime.config
        return {
            "theme": config.theme.name,
            "density": config.theme.density,
            "borders": config.theme.borders,
            "mouse": str(config.theme.mouse).lower(),
            "week_starts_on": str(config.preferences.week_starts_on),
        }

    def _settings_result(self, result: dict[str, str] | None) -> None:
        if result is None:
            return
        try:
            theme = result["theme"]
            density = result["density"]
            borders = result["borders"]
            mouse_raw = result["mouse"].casefold()
            if theme not in {"system", "dark", "light", "mono"}:
                raise ValueError("theme must be system, dark, light, or mono")
            if density not in {"compact", "comfortable"}:
                raise ValueError("density must be compact or comfortable")
            if borders not in {"unicode", "ascii"}:
                raise ValueError("borders must be unicode or ascii")
            if mouse_raw not in {"true", "false"}:
                raise ValueError("mouse must be true or false")
            config = self.runtime.update_tui_settings(
                theme=theme,
                density=density,
                borders=borders,
                mouse=mouse_raw == "true",
                week_starts_on=int(result["week_starts_on"]),
            )
        except ValueError as exc:
            self.notify(str(exc), severity="error")
            return
        self.remove_class("density-compact", "density-comfortable", "ascii", "no-mouse")
        self.density = config.theme.density
        self.border_style = config.theme.borders
        self.mouse_enabled = config.theme.mouse
        self.add_class(f"density-{self.density}")
        self.set_class(self.border_style == "ascii", "ascii")
        self.set_class(not self.mouse_enabled, "no-mouse")
        self._render_chrome()
        self.notify("Settings saved; theme changes apply fully on restart")

    def find_time_local(
        self, raw_day: str, raw_duration: str, raw_start: str, raw_end: str
    ) -> tuple[TimeSlot, ...]:
        if self.account_id is None:
            return ()
        return self.runtime.application.find_time(
            self.account_id,
            date.fromisoformat(raw_day),
            duration_minutes=int(raw_duration),
            day_start=int(raw_start),
            day_end=int(raw_end),
        )

    def action_jump(self) -> None:
        self.push_screen(
            EditorScreen(due=self.selected_date.isoformat(), jump=True),
            self._jump_result,
        )

    def _jump_result(self, result: dict[str, str] | None) -> None:
        if not result:
            return
        try:
            self.selected_date = date.fromisoformat(result["date"])
        except ValueError:
            self.notify("Use a date in YYYY-MM-DD format", severity="error")
            return
        self._render_chrome()
        self._render_surface()

    @work(thread=True, exclusive=True, group="sync")
    def action_sync(self) -> None:
        if self.account_id is None:
            self.call_from_thread(
                self.notify,
                "Connect an account before syncing",
                severity="warning",
            )
            return
        self.syncing = True
        self.call_from_thread(self._render_chrome)
        try:
            result = self.runtime.sync_engine(self.account_id).sync(self.account_id)
        except HcbError as exc:
            self.call_from_thread(self.notify, str(exc), severity="error")
        except Exception as exc:  # provider failures must not tear down the workspace
            self.call_from_thread(self.notify, f"Sync failed: {exc}", severity="error")
        else:
            self.call_from_thread(
                self.notify,
                f"Sync complete: {result.pulled} pulled, {result.pushed} pushed",
            )
        finally:
            self.syncing = False
            self.call_from_thread(self.refresh_workspace)


def run_tui(runtime: Runtime | None = None, *, account: str | None = None) -> None:
    """Run the interactive product without performing an implicit sync."""
    HcbApp(runtime, account=account).run()
