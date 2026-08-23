"""Textual workspace for the local-first HCB application."""

from __future__ import annotations

import calendar
import json
import re
import shlex
import subprocess
import tempfile
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from time import monotonic
from typing import ClassVar, Literal, cast
from zoneinfo import available_timezones

from rich._emoji_codes import EMOJI as RICH_EMOJI
from rich.color import Color as RichColor
from rich.style import Style
from rich.text import Text
from textual import events, work
from textual._text_area_theme import TextAreaTheme
from textual.app import App, ComposeResult, SuspendNotSupported
from textual.binding import Binding
from textual.color import Color
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.theme import Theme as TextualTheme
from textual.widgets import (
    Button,
    Footer,
    Label,
    ListItem,
    ListView,
    Select,
    Static,
    TextArea,
)
from textual.widgets import (
    Input as TextualInput,
)

from .application import ResponseStatus, SearchResult, TimeSlot
from .config import Config, ConfigError, ThemeColors, load
from .errors import AuthenticationRequired, HcbError
from .import_export import ImportPreview
from .loaders import LOADER_NAMES, LOADER_PRESETS, loader_preset
from .models import ConflictStatus, DateTimeKind, Event, EventDateTime, Task, TaskStatus
from .runtime import DEFAULT_CREDENTIAL_FILE, Runtime
from .storage import Storage

SURFACES = ("Tasks", "Notes", "Agenda", "Day", "Week", "Month")
PALETTE_COMMANDS = (
    ("Create item", "create"),
    ("Sync now", "sync"),
    ("Refresh recurring instances", "refresh-instances"),
    ("Find a time", "find-time"),
    ("Calendars", "calendars"),
    ("Settings", "settings"),
    ("Doctor", "doctor"),
    ("Bulk actions", "bulk"),
    ("Schedule task", "schedule"),
    ("Import", "import"),
    ("Conflicts", "conflicts"),
    ("First-run setup", "onboarding"),
)

PROFILE_OPTIONS = (
    ("Terminal", "terminal"),
    ("Dark", "dark"),
    ("Light", "light"),
)
DENSITY_OPTIONS = (
    ("Comfortable", "comfortable"),
    ("Compact", "compact"),
)
BORDER_OPTIONS = (
    ("ASCII", "ascii"),
    ("Unicode", "unicode"),
    ("None", "none"),
)
FOCUS_OPTIONS = (
    ("ASCII", "ascii"),
    ("Underline", "underline"),
    ("Inverse", "inverse"),
)
BOOLEAN_OPTIONS = (
    ("Enabled", "true"),
    ("Disabled", "false"),
)
WEEK_START_OPTIONS = (
    ("Monday", "0"),
    ("Tuesday", "1"),
    ("Wednesday", "2"),
    ("Thursday", "3"),
    ("Friday", "4"),
    ("Saturday", "5"),
    ("Sunday", "6"),
)
TIME_ZONE_OPTIONS = tuple((time_zone, time_zone) for time_zone in sorted(available_timezones()))

_EMOJI_QUERY = re.compile(r":([A-Za-z0-9_+\-]+)$")
_EMOJI_SUGGESTION_LIMIT = 8
_EMOJI_NAMES = tuple(sorted(RICH_EMOJI))


def emoji_suggestions(text: str, cursor: int) -> tuple[int, tuple[tuple[str, str], ...]] | None:
    """Return the active ``:emoji`` token and its Rich-backed prefix matches."""
    match = _EMOJI_QUERY.search(text[: max(0, min(cursor, len(text)))])
    if match is None:
        return None
    query = match.group(1).casefold()
    candidates = tuple(
        (name, RICH_EMOJI[name]) for name in _EMOJI_NAMES if name.casefold().startswith(query)
    )[:_EMOJI_SUGGESTION_LIMIT]
    return (match.start(), candidates) if candidates else None


class EmojiCompletion(Static):
    """A non-focus-stealing suggestion surface shared by text editors."""

    def __init__(self) -> None:
        super().__init__(id="emoji-completion", markup=False)
        self.display = False

    def set_candidates(self, candidates: tuple[tuple[str, str], ...], selected: int) -> None:
        self.update(
            "\n".join(
                f"{'> ' if index == selected else '  '}:{name}: {emoji}"
                for index, (name, emoji) in enumerate(candidates)
            )
        )
        self.display = True


class Input(TextualInput):
    """Keep a visible terminal-style caret in every single-line editor."""

    def on_mount(self) -> None:
        self.cursor_blink = False

    async def _on_key(self, event: events.Key) -> None:
        app = self.app
        if isinstance(app, HcbApp) and app.handle_emoji_key(self, event):
            return
        if isinstance(app, HcbApp) and app.handle_external_editor_key(self, event):
            return
        await super()._on_key(event)
        if isinstance(app, HcbApp):
            app.update_emoji_completion(self)

    def on_blur(self, event: events.Blur) -> None:
        app = self.app
        if isinstance(app, HcbApp):
            app.dismiss_emoji_completion(self)


@dataclass(frozen=True, slots=True)
class CachedWorkspace:
    identity: str = ""
    tasks: tuple[Task, ...] = ()
    events: tuple[Event, ...] = ()
    task_lists: tuple[tuple[str, str], ...] = ()
    calendars: tuple[tuple[str, str, bool], ...] = ()
    instance_ranges: tuple[dict[str, str], ...] = ()
    pending: int = 0


class EntityRow(ListItem):
    """A selectable row carrying a domain identity."""

    def __init__(self, label: str, *, kind: str, item_id: str, action: str | None = None) -> None:
        super().__init__(Label(label, markup=False))
        self.kind = kind
        self.item_id = item_id
        self.palette_action = action


class TerminalTextArea(TextArea):
    """Use terminal-default Rich colors where Textual itself needs an opaque base style."""

    def on_mount(self) -> None:
        self.cursor_blink = False
        self.apply_terminal_theme()

    async def _on_key(self, event: events.Key) -> None:
        app = self.app
        if isinstance(app, HcbApp) and app.handle_emoji_key(self, event):
            return
        if isinstance(app, HcbApp) and app.handle_external_editor_key(self, event):
            return
        await super()._on_key(event)
        if isinstance(app, HcbApp):
            app.update_emoji_completion(self)

    def on_blur(self, event: events.Blur) -> None:
        app = self.app
        if isinstance(app, HcbApp):
            app.dismiss_emoji_completion(self)

    def apply_terminal_theme(self) -> None:
        colors = cast(HcbApp, self.app).runtime.config.theme.colors
        self.register_theme(
            TextAreaTheme(
                "hcb-terminal",
                base_style=Style(
                    color=self._rich_color(colors.text),
                    bgcolor=self._rich_color(colors.control),
                ),
            )
        )
        self.theme = "css"
        self.theme = "hcb-terminal"

    @staticmethod
    def _rich_color(value: str) -> RichColor | str:
        if value in {"transparent", "ansi_default"}:
            return "default"
        return Color.parse(value).rich_color


type EmojiTarget = Input | TerminalTextArea
type EditorRunner = Callable[[list[str]], int]
type SuspendContext = Callable[[], AbstractContextManager[None]]


def _run_editor(command: list[str]) -> int:
    return subprocess.run(command, check=False).returncode


class RattlesLoader(Static):
    """Animate the configured Rattles preset using its source timing."""

    def __init__(self) -> None:
        super().__init__(id="rattles-loader")
        self._started_at = monotonic()

    def on_mount(self) -> None:
        self._render_frame()
        self.set_interval(0.05, self._render_frame)

    def _render_frame(self) -> None:
        app = cast(HcbApp, self.app)
        preset = loader_preset(app.runtime.config.theme.loader)
        self.update(preset.frame_at(monotonic() - self._started_at))


class LoadingScreen(ModalScreen[None]):
    """Non-dismissable progress surface shared by each remote TUI operation."""

    def __init__(self, message: str) -> None:
        super().__init__()
        self.message = message

    def compose(self) -> ComposeResult:
        with Vertical(id="loading-dialog"):
            yield RattlesLoader()
            yield Label(self.message, id="loading-message")

    def set_message(self, message: str) -> None:
        self.message = message
        self.query_one("#loading-message", Label).update(message)


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
                yield TerminalTextArea(self.initial_notes, id="editor-notes")
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

    def __init__(
        self,
        message: str,
        *,
        confirm_label: str = "Confirm",
        confirm_variant: Literal["default", "primary", "success", "warning", "error"] = "primary",
    ) -> None:
        super().__init__()
        self.message = message
        self.confirm_label = confirm_label
        self.confirm_variant = confirm_variant

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm-dialog"):
            yield Label(self.message, markup=False)
            with Horizontal(classes="dialog-buttons"):
                yield Button(self.confirm_label, variant=self.confirm_variant, id="confirm")
                yield Button("Cancel", id="cancel")

    def action_confirm(self) -> None:
        self.dismiss(True)

    def action_cancel(self) -> None:
        self.dismiss(False)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "confirm")


class OnboardingScreen(ModalScreen[dict[str, str] | None]):
    """First-run setup; no network action occurs inside this screen."""

    BINDINGS = [Binding("escape", "offline", "Stay offline")]

    def compose(self) -> ComposeResult:
        with Vertical(id="onboarding-dialog"):
            yield Label("First-run setup", id="dialog-title")
            yield Static("Google is optional until you explicitly confirm connection.")
            with VerticalScroll(id="onboarding-fields"):
                with Horizontal(classes="onboarding-field"):
                    yield Label("Credential .env path")
                    yield Input(
                        value=str(DEFAULT_CREDENTIAL_FILE),
                        placeholder="Credential .env path",
                        id="onboard-env-file",
                    )
                with Horizontal(classes="onboarding-field"):
                    yield Label("Local account identifier")
                    yield Input(placeholder="Local account identifier", id="onboard-account")
                with Horizontal(classes="onboarding-field"):
                    yield Label("Account email")
                    yield Input(placeholder="Account email", id="onboard-email")
                with Horizontal(classes="onboarding-field"):
                    yield Label("Time zone")
                    yield Select(
                        TIME_ZONE_OPTIONS,
                        allow_blank=False,
                        prompt="Time zone",
                        value="UTC",
                        id="onboard-timezone",
                    )
                with Horizontal(classes="onboarding-field"):
                    yield Label("Reminders")
                    yield Select(
                        BOOLEAN_OPTIONS,
                        allow_blank=False,
                        prompt="Reminders",
                        value="true",
                        id="onboard-reminders",
                    )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Save offline", id="onboard-offline")
                yield Button("Save and connect", variant="primary", id="onboard-connect")

    def action_offline(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id not in {"onboard-offline", "onboard-connect"}:
            return
        self.dismiss(
            {
                "env_file": self.query_one("#onboard-env-file", Input).value.strip(),
                "account_id": self.query_one("#onboard-account", Input).value.strip(),
                "email": self.query_one("#onboard-email", Input).value.strip(),
                "time_zone": self._selected_value("#onboard-timezone", "a time zone"),
                "reminders": self._selected_value("#onboard-reminders", "a reminder setting"),
                "connect": str(event.button.id == "onboard-connect").lower(),
            }
        )

    def _selected_value(self, selector: str, label: str) -> str:
        value = self.query_one(selector, Select).value
        if not isinstance(value, str):
            raise ValueError(f"select {label}")
        return value


class ScheduleScreen(ModalScreen[None]):
    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, hcb: HcbApp, task_id: str = "") -> None:
        super().__init__()
        self.hcb = hcb
        self.task_id = task_id

    def compose(self) -> ComposeResult:
        default_calendar = self.hcb.cache.calendars[0][0] if self.hcb.cache.calendars else ""
        with Vertical(id="schedule-dialog"):
            yield Label("Task schedule block", id="dialog-title")
            yield Input(value=self.task_id, placeholder="Task id", id="schedule-task")
            yield Input(value=default_calendar, placeholder="Calendar id", id="schedule-calendar")
            yield Input(placeholder="Existing event id for repair", id="schedule-event")
            yield Input(placeholder="Start ISO timestamp", id="schedule-start")
            yield Input(placeholder="End ISO timestamp", id="schedule-end")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Schedule / move", variant="primary", id="schedule-save")
                yield Button("Unschedule", variant="error", id="schedule-remove")
                yield Button("Repair link", id="schedule-repair")
                yield Button("Close", id="schedule-close")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "schedule-close":
            self.dismiss(None)
            return
        if self.hcb.account_id is None:
            return
        task_id = self.query_one("#schedule-task", Input).value.strip()
        try:
            if event.button.id == "schedule-remove":
                self.app.push_screen(
                    ConfirmScreen(
                        "Delete this task's active calendar block?",
                        confirm_label="Delete",
                        confirm_variant="error",
                    ),
                    lambda confirmed: self._unschedule(task_id, confirmed),
                )
                return
            elif event.button.id == "schedule-repair":
                self.hcb.runtime.application.repair_task_schedule(
                    self.hcb.account_id,
                    task_id,
                    self.query_one("#schedule-event", Input).value.strip(),
                )
            else:
                self.hcb.runtime.application.schedule_task(
                    self.hcb.account_id,
                    task_id,
                    self.query_one("#schedule-calendar", Input).value.strip(),
                    self.hcb._parse_event_point(
                        self.query_one("#schedule-start", Input).value.strip()
                    ),
                    self.hcb._parse_event_point(
                        self.query_one("#schedule-end", Input).value.strip()
                    ),
                )
        except (ValueError, HcbError) as exc:
            self.hcb.notify(str(exc), severity="error")
            return
        self.hcb.refresh_workspace()
        self.hcb.notify("Schedule updated")

    def _unschedule(self, task_id: str, confirmed: bool | None) -> None:
        if confirmed and self.hcb.account_id is not None:
            self.hcb.runtime.application.unschedule_task(self.hcb.account_id, task_id)
            self.hcb.refresh_workspace()
            self.hcb.notify("Task unscheduled")


class BulkScreen(ModalScreen[None]):
    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, hcb: HcbApp) -> None:
        super().__init__()
        self.hcb = hcb

    def compose(self) -> ComposeResult:
        with Vertical(id="bulk-dialog"):
            yield Label(
                f"Bulk actions · {len(self.hcb.marked)} task(s), "
                f"{len(self.hcb.marked_events)} event(s)"
            )
            yield Button("Complete marked", variant="primary", id="bulk-complete")
            yield Button("RSVP to marked events", id="bulk-rsvp")
            yield Button("Delete marked…", variant="error", id="bulk-delete")
            yield Button("Close", id="bulk-close")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "bulk-close":
            self.dismiss(None)
        elif event.button.id == "bulk-complete":
            self.dismiss(None)
            self.hcb.action_complete()
        elif event.button.id == "bulk-delete":
            self.dismiss(None)
            self.hcb.action_delete()
        elif event.button.id == "bulk-rsvp":
            self.dismiss(None)
            self.hcb.action_rsvp()


class ImportScreen(ModalScreen[None]):
    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, hcb: HcbApp) -> None:
        super().__init__()
        self.hcb = hcb
        self.preview: ImportPreview | None = None

    def compose(self) -> ComposeResult:
        with Vertical(id="import-dialog"):
            yield Label("Import preview", id="dialog-title")
            yield Input(placeholder="CSV, JSON, or ICS path", id="import-path")
            yield Static("Choose Preview; nothing is written until Apply.", id="import-summary")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Preview", variant="primary", id="import-preview")
                yield Button("Apply accepted rows", id="import-apply")
                yield Button("Close", id="import-close")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "import-close":
            self.dismiss(None)
            return
        if self.hcb.account_id is None:
            return
        try:
            if event.button.id == "import-preview":
                target = Path(self.query_one("#import-path", Input).value).expanduser()
                self.preview = self.hcb.runtime.application.preview_import(
                    target.name, target.read_bytes()
                )
                accepted = sum(row.record is not None for row in self.preview.rows)
                skipped = len(self.preview.rows) - accepted
                self.query_one("#import-summary", Static).update(
                    f"Accepted: {accepted} · skipped: {skipped} · errors: "
                    f"{len(self.preview.errors)}"
                )
            elif self.preview is None:
                raise ValueError("preview the import before applying it")
            else:
                self.app.push_screen(
                    ConfirmScreen("Apply all accepted import rows atomically?"),
                    self._apply_confirmed,
                )
        except (OSError, ValueError, HcbError) as exc:
            self.hcb.notify(str(exc), severity="error")

    def _apply_confirmed(self, confirmed: bool | None) -> None:
        if not confirmed or self.preview is None or self.hcb.account_id is None:
            return
        try:
            result = self.hcb.runtime.application.apply_import(
                self.hcb.account_id,
                self.preview,
                default_task_list_id=(
                    self.hcb.cache.task_lists[0][0] if self.hcb.cache.task_lists else None
                ),
                default_calendar_id=(
                    self.hcb.cache.calendars[0][0] if self.hcb.cache.calendars else None
                ),
            )
        except (ValueError, HcbError) as exc:
            self.hcb.notify(str(exc), severity="error")
            return
        self.hcb.refresh_workspace()
        self.hcb.notify(f"Imported {len(result.tasks)} tasks and {len(result.events)} events")


class ConflictScreen(ModalScreen[None]):
    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, hcb: HcbApp) -> None:
        super().__init__()
        self.hcb = hcb
        self.conflict_id: int | None = None

    def compose(self) -> ComposeResult:
        with Vertical(id="conflict-dialog"):
            yield Label("Sync conflicts", id="dialog-title")
            yield ListView(id="conflict-list")
            yield Input(
                placeholder="Remote ID (required when uncertain create was delivered)",
                id="conflict-remote-id",
            )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Keep local", id="conflict-local")
                yield Button("Keep Google", id="conflict-remote")
                yield Button("Close", id="conflict-close")

    def on_mount(self) -> None:
        if self.hcb.account_id is None:
            return
        view = self.query_one("#conflict-list", ListView)
        for conflict in self.hcb.runtime.storage.list_conflicts(self.hcb.account_id):
            view.append(
                EntityRow(
                    f"{conflict.id} · {conflict.entity_type.value} · {conflict.entity_id}",
                    kind="conflict",
                    item_id=str(conflict.id),
                )
            )
        if view.children:
            view.index = 0

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        if isinstance(event.item, EntityRow):
            self.conflict_id = int(event.item.item_id)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "conflict-close":
            self.dismiss(None)
        elif self.conflict_id is not None and self.hcb.account_id is not None:
            conflict = next(
                (
                    item
                    for item in self.hcb.runtime.storage.list_conflicts(self.hcb.account_id)
                    if item.id == self.conflict_id
                ),
                None,
            )
            if conflict is None:
                return
            resolution = (
                ConflictStatus.KEEP_LOCAL
                if event.button.id == "conflict-local"
                else ConflictStatus.KEEP_REMOTE
            )
            try:
                if conflict.local_payload.get("kind") == "uncertain-delivery":
                    self.hcb.runtime.application.resolve_uncertain_delivery(
                        self.hcb.account_id,
                        self.conflict_id,
                        "retry" if resolution is ConflictStatus.KEEP_LOCAL else "delivered",
                        remote_id=self.query_one("#conflict-remote-id", Input).value.strip()
                        or None,
                    )
                else:
                    self.hcb.runtime.application.resolve_conflict(
                        self.hcb.account_id, self.conflict_id, resolution
                    )
            except (ValueError, HcbError) as exc:
                self.hcb.notify(str(exc), severity="error")
                return
            self.dismiss(None)
            self.hcb.notify("Conflict resolved")


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
            yield Input(
                value=" | ".join(event.recurrence) if event else "",
                placeholder="Recurrence lines separated by |",
                id="event-recurrence",
            )
            yield TerminalTextArea(event.description or "" if event else "", id="event-description")
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
                "recurrence": self.query_one("#event-recurrence", Input).value.strip(),
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
            with Horizontal(classes="settings-pair"):
                yield Select(
                    PROFILE_OPTIONS,
                    allow_blank=False,
                    prompt="Profile",
                    value=values["profile"],
                    id="setting-profile",
                )
                yield Select(
                    DENSITY_OPTIONS,
                    allow_blank=False,
                    prompt="Density",
                    value=values["density"],
                    id="setting-density",
                )
            with Horizontal(classes="settings-pair"):
                yield Select(
                    BORDER_OPTIONS,
                    allow_blank=False,
                    prompt="Border style",
                    value=values["borders"],
                    id="setting-borders",
                )
                yield Select(
                    FOCUS_OPTIONS,
                    allow_blank=False,
                    prompt="Focus style",
                    value=values["focus"],
                    id="setting-focus",
                )
            with Horizontal(classes="settings-pair"):
                yield Select(
                    BOOLEAN_OPTIONS,
                    allow_blank=False,
                    prompt="Mouse support",
                    value=values["mouse"],
                    id="setting-mouse",
                )
                yield Select(
                    WEEK_START_OPTIONS,
                    allow_blank=False,
                    prompt="Week starts on",
                    value=values["week_starts_on"],
                    id="setting-week",
                )
            with Horizontal(classes="settings-pair"):
                yield Input(
                    value=values["editor"],
                    placeholder="External editor command",
                    id="setting-editor",
                )
                yield Input(
                    value=values["external_editor"],
                    placeholder="External editor shortcut",
                    id="setting-external-editor",
                )
            yield Select(
                [(name, name) for name in LOADER_NAMES],
                allow_blank=False,
                prompt="Loading indicator",
                value=values["loader"],
                id="setting-loader",
            )
            yield Label("Semantic colors (strict JSON object)", id="settings-colors-label")
            yield TerminalTextArea(values["colors"], id="settings-colors")
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
                "profile": self._selected_value("#setting-profile", "a profile"),
                "density": self._selected_value("#setting-density", "a density"),
                "borders": self._selected_value("#setting-borders", "a border style"),
                "focus": self._selected_value("#setting-focus", "a focus style"),
                "mouse": self._selected_value("#setting-mouse", "a mouse setting"),
                "week_starts_on": self._selected_value("#setting-week", "a week start day"),
                "editor": self.query_one("#setting-editor", Input).value.strip(),
                "external_editor": self.query_one("#setting-external-editor", Input).value.strip(),
                "loader": self._selected_loader(),
                "colors": self.query_one("#settings-colors", TextArea).text.strip(),
            }
        )

    def _selected_loader(self) -> str:
        return self._selected_value("#setting-loader", "a loading indicator")

    def _selected_value(self, selector: str, label: str) -> str:
        value = self.query_one(selector, Select).value
        if not isinstance(value, str):  # allow_blank=False makes this defensive only.
            raise ValueError(f"select {label}")
        return value


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
                yield Button("Query Google free/busy", id="find-remote")
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
        elif event.button.id == "find-remote":
            self.hcb.request_remote_freebusy(
                self.query_one("#find-date", Input).value,
                self.query_one("#find-start", Input).value,
                self.query_one("#find-end", Input).value,
                self._show_remote_freebusy,
            )
        else:
            self.dismiss(None)

    def action_close(self) -> None:
        self.dismiss(None)

    def _show_remote_freebusy(self, result: dict[str, object]) -> None:
        calendars = result.get("calendars", {})
        busy = 0
        if isinstance(calendars, dict):
            for value in calendars.values():
                if isinstance(value, dict):
                    intervals = value.get("busy", ())
                    if isinstance(intervals, (list, tuple)):
                        busy += len(intervals)
        self.query_one("#find-disclosure", Static).update(
            f"Explicit Google free/busy complete · {busy} busy interval(s)"
        )


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
        Binding("u", "undo", "Undo"),
        Binding("ctrl+r", "redo", "Redo"),
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
        editor_runner: EditorRunner | None = None,
        suspend: SuspendContext | None = None,
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
        self.marked_events: set[str] = set()
        self.loading_operation: str | None = None
        self._loading_screen: LoadingScreen | None = None
        self._theme_revision = 0
        self._observed_config_marker: tuple[int, int] | None = None
        self._emoji_target: EmojiTarget | None = None
        self._emoji_token_start: int | None = None
        self._emoji_matches: tuple[tuple[str, str], ...] = ()
        self._emoji_selection = 0
        self._emoji_popup: EmojiCompletion | None = None
        self._emoji_popup_screen: object | None = None
        self._editor_runner = editor_runner or _run_editor
        self._editor_suspend = suspend or self.suspend
        self._set_visual_state(self.runtime.config)

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
        self._apply_visual_config(self.runtime.config)
        self._observed_config_marker = self._config_marker()
        self.set_interval(0.5, self._reload_visual_config)
        self._bind_configured_keys()
        try:
            self.account_id = self.runtime.account_id(self.explicit_account)
        except AuthenticationRequired:
            self.account_id = None
        self.refresh_workspace()
        if self.account_id is None and not self.runtime.storage.list_accounts():
            self.call_after_refresh(
                lambda: self.push_screen(OnboardingScreen(), self._onboarding_result)
            )

    def _set_visual_state(self, config: Config) -> None:
        forced_terminal = (
            self.runtime.environ.get("NO_COLOR") is not None
            or self.runtime.environ.get("TERM") == "dumb"
        )
        self.theme_mode = "mono" if forced_terminal else config.theme.profile
        self.density = config.theme.density
        self.border_style = "ascii" if forced_terminal else config.theme.borders
        self.focus_style = "ascii" if forced_terminal else config.theme.focus
        self.mouse_enabled = config.theme.mouse and not forced_terminal

    def _apply_visual_config(self, config: Config) -> None:
        self._set_visual_state(config)
        colors = config.theme.colors
        self._theme_revision += 1
        name = f"hcb-config-{self._theme_revision}"
        self.register_theme(
            TextualTheme(
                name=name,
                primary=colors.focus,
                secondary=colors.accent,
                accent=colors.accent,
                foreground=colors.text,
                background=colors.background,
                surface=colors.surface,
                panel=colors.panel,
                boost=colors.control,
                success=colors.success,
                warning=colors.warning,
                error=colors.danger,
                dark=self.theme_mode != "light",
                variables={
                    "text-muted": colors.muted,
                    "border": colors.border,
                    "border-blurred": colors.border,
                    "footer-background": colors.overlay,
                    "input-selection-background": colors.selection,
                    "screen-selection-background": colors.selection,
                },
            )
        )
        self.theme = name
        self.remove_class(
            "theme-terminal",
            "theme-dark",
            "theme-light",
            "theme-mono",
            "density-compact",
            "density-comfortable",
            "borders-ascii",
            "borders-unicode",
            "focus-ascii",
            "focus-underline",
            "focus-reverse",
            "ascii",
            "no-mouse",
        )
        self.add_class(
            f"theme-{self.theme_mode}",
            f"density-{self.density}",
            f"borders-{self.border_style}",
            f"focus-{self.focus_style}",
        )
        self.set_class(self.border_style == "ascii", "ascii")
        self.set_class(not self.mouse_enabled, "no-mouse")
        self.dark = self.theme_mode != "light"
        for text_area in self.query(TerminalTextArea):
            text_area.apply_terminal_theme()

    def _config_marker(self) -> tuple[int, int] | None:
        try:
            stat = self.runtime.paths.config_file.stat()
        except FileNotFoundError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def _reload_visual_config(self) -> None:
        marker = self._config_marker()
        if marker == self._observed_config_marker:
            return
        self._observed_config_marker = marker
        try:
            config = load(self.runtime.paths.config_file)
        except ConfigError as exc:
            self.notify(f"config.json not applied: {exc}", severity="error")
            return
        self.runtime.__dict__["config"] = config
        self._apply_visual_config(config)
        self._render_chrome()
        self.notify("config.json visual settings reloaded")

    def _onboarding_result(self, result: dict[str, str] | None) -> None:
        if result is None:
            self.notify("Offline mode; setup can be reopened later")
            return
        reminders = result["reminders"].casefold()
        if reminders not in {"true", "false"}:
            self.notify("Reminders must be true or false", severity="error")
            self.push_screen(OnboardingScreen(), self._onboarding_result)
            return
        try:
            self.runtime.save_onboarding(
                account_id=result["account_id"],
                email=result["email"],
                time_zone=result["time_zone"],
                reminders_enabled=reminders == "true",
            )
        except ValueError as exc:
            self.notify(str(exc), severity="error")
            self.push_screen(OnboardingScreen(), self._onboarding_result)
            return
        self.account_id = result["account_id"]
        if result["env_file"]:
            self.runtime.credential_file_override = Path(result["env_file"]).expanduser()
        self.refresh_workspace()
        if result["connect"] == "true":
            self.push_screen(
                ConfirmScreen(
                    "Open the browser and connect this Google account now?",
                    confirm_label="Connect",
                ),
                self._onboarding_connect_confirmed,
            )
        else:
            self.notify("Offline account created; Google remains disconnected")

    def _onboarding_connect_confirmed(self, confirmed: bool | None) -> None:
        if not confirmed or self.account_id is None:
            self.notify("Google connection skipped; local cache remains available")
            return
        self.start_loading("Connecting to Google")
        self.connect_google()

    @work(thread=True, exclusive=True, group="auth")
    def connect_google(self) -> None:
        if self.account_id is None:
            return
        try:
            self.runtime.authenticator(self.account_id).connect(self.account_id)
        except Exception as exc:
            self.call_from_thread(self.notify, f"Google connection failed: {exc}", severity="error")
        else:
            self.call_from_thread(self.notify, "Google connected; sync remains explicit")
        finally:
            self.call_from_thread(self.stop_loading)

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

    def on_input_changed(self, event: TextualInput.Changed) -> None:
        if isinstance(event.input, Input):
            self.update_emoji_completion(event.input)

    def on_text_area_changed(self, event: TextArea.Changed) -> None:
        if isinstance(event.text_area, TerminalTextArea):
            self.update_emoji_completion(event.text_area)

    def update_emoji_completion(self, target: EmojiTarget) -> None:
        """Refresh suggestions for the focused editor's active colon token."""
        if self.focused is not target:
            self.dismiss_emoji_completion(target)
            return
        text, cursor = self._emoji_text_and_cursor(target)
        suggestion = emoji_suggestions(text, cursor)
        if suggestion is None:
            self.dismiss_emoji_completion(target)
            return
        token_start, matches = suggestion
        self._emoji_target = target
        self._emoji_token_start = token_start
        self._emoji_matches = matches
        self._emoji_selection = 0
        self._render_emoji_completion()

    def handle_emoji_key(self, target: EmojiTarget, event: events.Key) -> bool:
        """Consume navigation keys only while this editor owns an emoji menu."""
        if target is not self._emoji_target or not self._emoji_matches:
            return False
        if event.key == "up":
            self._emoji_selection = (self._emoji_selection - 1) % len(self._emoji_matches)
        elif event.key == "down":
            self._emoji_selection = (self._emoji_selection + 1) % len(self._emoji_matches)
        elif event.key in {"tab", "enter"}:
            self._accept_emoji_completion(target)
        elif event.key == "escape":
            self.dismiss_emoji_completion(target)
        else:
            return False
        event.stop()
        event.prevent_default()
        if event.key in {"up", "down"}:
            self._render_emoji_completion()
        return True

    def handle_external_editor_key(self, target: EmojiTarget, event: events.Key) -> bool:
        if event.key != self.runtime.config.keys.external_editor:
            return False
        event.stop()
        event.prevent_default()
        self.action_external_editor()
        return True

    def dismiss_emoji_completion(self, target: EmojiTarget | None = None) -> None:
        if target is not None and target is not self._emoji_target:
            return
        self._emoji_target = None
        self._emoji_token_start = None
        self._emoji_matches = ()
        self._emoji_selection = 0
        if self._emoji_popup is not None:
            self._emoji_popup.display = False

    def _render_emoji_completion(self) -> None:
        if not self._emoji_matches:
            return
        screen = self.screen
        if self._emoji_popup_screen is not screen:
            if self._emoji_popup is not None:
                self._emoji_popup.display = False
            self._emoji_popup = EmojiCompletion()
            self._emoji_popup_screen = screen
            screen.mount(self._emoji_popup)
        assert self._emoji_popup is not None
        self._emoji_popup.set_candidates(self._emoji_matches, self._emoji_selection)

    @staticmethod
    def _emoji_text_and_cursor(target: EmojiTarget) -> tuple[str, int]:
        if isinstance(target, Input):
            return target.value, target.cursor_position
        row, column = target.cursor_location
        offset = sum(
            len(target.document[index]) + len(target.document.newline) for index in range(row)
        )
        return target.text, offset + column

    @staticmethod
    def _text_area_location(target: TerminalTextArea, offset: int) -> tuple[int, int]:
        remaining = max(0, min(offset, len(target.text)))
        for row in range(target.document.line_count):
            length = len(target.document[row])
            if remaining <= length:
                return row, remaining
            remaining -= length
            if row < target.document.line_count - 1:
                remaining -= len(target.document.newline)
        return target.document.end

    def _accept_emoji_completion(self, target: EmojiTarget) -> None:
        if self._emoji_token_start is None or not self._emoji_matches:
            return
        token_start = self._emoji_token_start
        emoji = self._emoji_matches[self._emoji_selection][1]
        if isinstance(target, Input):
            target.replace(emoji, token_start, target.cursor_position)
            target.cursor_position = token_start + len(emoji)
        else:
            result = target.replace(
                emoji,
                self._text_area_location(target, token_start),
                target.cursor_location,
                maintain_selection_offset=False,
            )
            target.cursor_location = result.end_location
        self.dismiss_emoji_completion(target)

    def _editor_command(self) -> str:
        return self.runtime.environ.get("HCB_EDITOR") or self.runtime.config.preferences.editor

    def action_external_editor(self) -> None:
        target = self.focused
        if not isinstance(target, (Input, TerminalTextArea)):
            return
        self.dismiss_emoji_completion(target)
        temporary_path: Path | None = None
        try:
            command = shlex.split(self._editor_command())
            if not command:
                raise ValueError("external editor command is empty")
            source = target.value if isinstance(target, Input) else target.text
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                prefix="hcb-",
                suffix=".txt",
                delete=False,
            ) as temporary:
                temporary.write(source)
                temporary_path = Path(temporary.name)
            with self._editor_suspend():
                return_code = self._editor_runner([*command, str(temporary_path)])
            if return_code != 0:
                self.notify(f"External editor exited with status {return_code}", severity="error")
                return
            edited = temporary_path.read_text(encoding="utf-8")
        except SuspendNotSupported:
            self.notify("External editor is unavailable in this environment", severity="error")
            return
        except (OSError, UnicodeError, ValueError) as exc:
            self.notify(f"External editor failed: {exc}", severity="error")
            return
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
        if isinstance(target, Input):
            target.value = " ".join(edited.rstrip("\r\n").splitlines())
            target.cursor_position = len(target.value)
        else:
            target.load_text(edited)
            target.cursor_location = target.document.end

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
        state = self.loading_operation or "offline cache"
        cache_badge = self._instance_cache_badge()
        suffix = f" · {cache_badge}" if cache_badge else ""
        self.query_one("#sync-state", Static).update(
            f"{state} · {self.cache.pending} pending{suffix}"
        )

    def start_loading(self, operation: str) -> None:
        """Show the selected loader while one explicit remote operation is in progress."""
        self.loading_operation = operation
        if self._loading_screen is None:
            self._loading_screen = LoadingScreen(operation)
            self.push_screen(self._loading_screen)
        else:
            self._loading_screen.set_message(operation)
        self._render_chrome()

    def stop_loading(self) -> None:
        """Remove the active loading surface after its worker has completed."""
        screen = self._loading_screen
        self.loading_operation = None
        self._loading_screen = None
        if screen is not None and self.screen is screen:
            self.pop_screen()
        self._render_chrome()

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

    @staticmethod
    def _event_day(value: date | datetime) -> date:
        return value.date() if isinstance(value, datetime) else value

    def _event_surface_range(self) -> tuple[date, date]:
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

    def _instance_cache_badge(self) -> str | None:
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
        details = f"{start.isoformat()}–{end.isoformat()}"
        if refreshed:
            details += f", refreshed {refreshed}"
        if stale_reason:
            details += f", {stale_reason.replace('-', ' ')}"
        return f"instances: {state} ({details})"

    def _events_for_surface(self) -> tuple[Event, ...]:
        start, end = self._event_surface_range()
        events = tuple(
            event
            for event in self.cache.events
            if self._event_day(event.end.value) > start and self._event_day(event.start.value) < end
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
        self._render_chrome()
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
            details = (
                f"Type: {event.event_type or 'default'}\n"
                f"Visibility: {event.visibility or 'default'}\n"
                f"Transparency: {event.transparency or 'default'}\n"
                f"Color: {event.color_id or 'default'}\n"
                f"Attendees: {len(event.attendees)}\n"
                f"RSVP: {event.attendee_response or 'none'}\n"
                "Reminders: "
                f"{'default' if event.reminder_use_default else len(event.reminder_overrides)}\n"
                f"Attachments: {len(event.attachments)}\n"
                f"Conference: {'yes' if event.conference else 'no'}\n"
                f"Guest flags: invite={event.guests_can_invite_others}, "
                f"modify={event.guests_can_modify}, see={event.guests_can_see_other_guests}"
            )
            properties = (
                event.focus_time_properties
                or event.out_of_office_properties
                or event.working_location_properties
            )
            self.query_one("#inspection", Static).update(
                Text(
                    f"{event.summary}\n\n{event.start.value.isoformat()} → "
                    f"{event.end.value.isoformat()}\n{event.location or ''}\n\n"
                    f"{event.description or 'No description'}\n\n{details}"
                    + (f"\nProperties: {properties}" if properties else "")
                    + "\n\nStructured CLI editing preserves specialist fields."
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
        self._render_chrome()
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
        elif kind == "refresh-instances":
            self.action_refresh_instances()
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
        elif kind == "bulk":
            self.push_screen(BulkScreen(self))
        elif kind == "schedule":
            task = self._selected_task()
            self.push_screen(ScheduleScreen(self, task.id if task else ""))
        elif kind == "import":
            self.push_screen(ImportScreen(self))
        elif kind == "conflicts":
            self.push_screen(ConflictScreen(self))
        elif kind == "onboarding":
            self.push_screen(OnboardingScreen(), self._onboarding_result)
        elif kind in {"task", "event"}:
            self.surface = "Tasks" if kind == "task" else "Agenda"
            self.selected = (kind, value)
            self._render_chrome()
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
                recurrence=tuple(
                    item.strip() for item in result["recurrence"].split("|") if item.strip()
                ),
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
                recurrence=tuple(
                    item.strip() for item in result["recurrence"].split("|") if item.strip()
                ),
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self.refresh_workspace()
        self.notify("Event updated")

    def action_rsvp(self) -> None:
        if self._selected_event() is None and not self.marked_events:
            self.notify("Select an event to RSVP", severity="warning")
            return
        self.push_screen(RsvpScreen(), self._rsvp_result)

    def _rsvp_result(self, response: str | None) -> None:
        event = self._selected_event()
        if (
            response is None
            or (event is None and not self.marked_events)
            or self.account_id is None
        ):
            return
        event_ids = list(self.marked_events) or ([event.id] if event else [])
        self.runtime.application.respond_events(
            self.account_id, event_ids, cast(ResponseStatus, response)
        )
        self.marked_events.clear()
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
        targets = [item for item in self.cache.tasks if item.id in ids]
        completed = not all(item.status is TaskStatus.COMPLETED for item in targets)
        self.runtime.application.complete_tasks(
            self.account_id, [item.id for item in targets], completed=completed
        )
        self.marked.clear()
        self.refresh_workspace()
        self.notify(f"Updated {len(ids)} task(s)")

    def action_mark(self) -> None:
        task = self._selected_task()
        event = self._selected_event()
        if task is not None:
            if task.id in self.marked:
                self.marked.remove(task.id)
            else:
                self.marked.add(task.id)
        elif event is not None:
            if event.id in self.marked_events:
                self.marked_events.remove(event.id)
            else:
                self.marked_events.add(event.id)
        self._render_surface()

    def action_delete(self) -> None:
        task = self._selected_task()
        event = self._selected_event()
        ids = set(self.marked)
        event_ids = set(self.marked_events)
        if not ids and task:
            ids.add(task.id)
        if not ids and not event_ids and event is None:
            self.notify("Select an item to delete", severity="warning")
            return
        count = len(ids) + len(event_ids) or 1
        self.push_screen(
            ConfirmScreen(
                f"Delete {count} selected item(s)?",
                confirm_label="Delete",
                confirm_variant="error",
            ),
            self._delete_result,
        )

    def _delete_result(self, confirmed: bool | None) -> None:
        if not confirmed or self.account_id is None:
            return
        event = self._selected_event()
        ids = set(self.marked)
        event_ids = set(self.marked_events)
        task = self._selected_task()
        if not ids and task:
            ids.add(task.id)
        if ids:
            self.runtime.application.delete_tasks(self.account_id, list(ids))
        if event and not ids and not event_ids:
            event_ids.add(event.id)
        if event_ids:
            self.runtime.application.delete_events(self.account_id, list(event_ids))
        self.marked.clear()
        self.marked_events.clear()
        self.selected = None
        self.refresh_workspace()
        self.notify("Deleted")

    def action_undo(self) -> None:
        if self.account_id is not None:
            changed = self.runtime.application.undo(self.account_id)
            self.refresh_workspace()
            self.notify("Nothing to undo" if changed is None else "Undone")

    def action_redo(self) -> None:
        if self.account_id is not None:
            changed = self.runtime.application.redo(self.account_id)
            self.refresh_workspace()
            self.notify("Nothing to redo" if changed is None else "Redone")

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

        self.push_screen(
            ConfirmScreen(
                "Delete this calendar and its cached events?",
                confirm_label="Delete",
                confirm_variant="error",
            ),
            apply,
        )

    def settings_values(self) -> dict[str, str]:
        config = self.runtime.config
        return {
            "profile": config.theme.profile,
            "density": config.theme.density,
            "borders": config.theme.borders,
            "focus": config.theme.focus,
            "mouse": str(config.theme.mouse).lower(),
            "loader": config.theme.loader,
            "week_starts_on": str(config.preferences.week_starts_on),
            "editor": config.preferences.editor,
            "external_editor": config.keys.external_editor,
            "colors": json.dumps(asdict(config.theme.colors), indent=2, sort_keys=True),
        }

    def _settings_result(self, result: dict[str, str] | None) -> None:
        if result is None:
            return
        try:
            profile = result["profile"]
            density = result["density"]
            borders = result["borders"]
            focus = result["focus"]
            mouse_raw = result["mouse"].casefold()
            if profile not in {"terminal", "dark", "light"}:
                raise ValueError("profile must be terminal, dark, or light")
            if density not in {"compact", "comfortable"}:
                raise ValueError("density must be compact or comfortable")
            if borders not in {"unicode", "ascii"}:
                raise ValueError("borders must be unicode or ascii")
            if focus not in {"ascii", "underline", "reverse"}:
                raise ValueError("focus must be ascii, underline, or reverse")
            if mouse_raw not in {"true", "false"}:
                raise ValueError("mouse must be true or false")
            loader = result["loader"]
            if loader not in LOADER_PRESETS:
                raise ValueError("choose a bundled Rattles loading indicator")
            if not result["editor"]:
                raise ValueError("external editor command must not be empty")
            if not result["external_editor"]:
                raise ValueError("external editor shortcut must not be empty")
            colors_data = json.loads(result["colors"])
            if not isinstance(colors_data, dict):
                raise ValueError("semantic colors must be a JSON object")
            colors = ThemeColors(**colors_data)
            config = self.runtime.update_tui_settings(
                profile=profile,
                density=density,
                borders=borders,
                focus=focus,
                mouse=mouse_raw == "true",
                loader=loader,
                week_starts_on=int(result["week_starts_on"]),
                editor=result["editor"],
                external_editor=result["external_editor"],
                colors=colors,
            )
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._apply_visual_config(config)
        self._observed_config_marker = self._config_marker()
        self._render_chrome()
        self.notify("Settings saved and applied")

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

    def _freebusy_request(
        self, raw_day: str, raw_start: str, raw_end: str
    ) -> tuple[str, dict[str, object]]:
        if self.account_id is None:
            raise ValueError("connect an account before querying Google")
        account_id = self.account_id
        day = date.fromisoformat(raw_day)
        start = datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=int(raw_start))
        end = datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=int(raw_end))
        calendars: list[dict[str, str]] = []
        for item_id, _summary, selected in self.cache.calendars:
            calendar_item = self.runtime.storage.get_calendar(account_id, item_id)
            if selected and calendar_item and calendar_item.remote_id:
                calendars.append({"id": calendar_item.remote_id})
        return account_id, {
            "timeMin": start.isoformat().replace("+00:00", "Z"),
            "timeMax": end.isoformat().replace("+00:00", "Z"),
            "items": calendars,
        }

    def remote_freebusy(self, raw_day: str, raw_start: str, raw_end: str) -> dict[str, object]:
        """Run the explicit Google request synchronously for non-TUI callers."""
        account_id, body = self._freebusy_request(raw_day, raw_start, raw_end)
        return self.runtime.sync_engine(account_id).gateway.freebusy(body)

    def request_remote_freebusy(
        self,
        raw_day: str,
        raw_start: str,
        raw_end: str,
        callback: Callable[[dict[str, object]], None],
    ) -> None:
        """Run the explicit Google query without suspending the active modal screen."""
        try:
            account_id, body = self._freebusy_request(raw_day, raw_start, raw_end)
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self.start_loading("Querying Google free/busy")
        self.query_remote_freebusy(account_id, body, callback)

    @work(thread=True, exclusive=True, group="freebusy")
    def query_remote_freebusy(
        self,
        account_id: str,
        body: dict[str, object],
        callback: Callable[[dict[str, object]], None],
    ) -> None:
        try:
            result = self.runtime.sync_engine(account_id).gateway.freebusy(body)
        except Exception as exc:  # Google failures must not tear down the workspace.
            self.call_from_thread(self.notify, f"Google free/busy failed: {exc}", severity="error")
        else:
            self.call_from_thread(callback, result)
        finally:
            self.call_from_thread(self.stop_loading)

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
        self.call_from_thread(self.start_loading, "Syncing with Google")
        worker_storage: Storage | None = None
        try:
            engine = self.runtime.sync_engine(self.account_id)
            worker_storage = Storage(self.runtime.paths.database_file)
            engine.storage = worker_storage
            result = engine.sync(self.account_id)
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
            if worker_storage is not None:
                worker_storage.close()
            self.call_from_thread(self.stop_loading)
            self.call_from_thread(self.refresh_workspace)

    @work(thread=True, exclusive=True, group="sync")
    def action_refresh_instances(self) -> None:
        """Explicitly refresh Google-expanded instances for the visible local range."""
        if self.account_id is None:
            self.call_from_thread(self.notify, "Connect an account first", severity="warning")
            return
        selected_event = self._selected_event()
        calendar_id = (
            self.resource_filter[1]
            if self.resource_filter and self.resource_filter[0] == "calendar"
            else (selected_event.calendar_id if selected_event else None)
        )
        if calendar_id is None:
            calendar_id = next(
                (item_id for item_id, _, selected in self.cache.calendars if selected), None
            )
        if calendar_id is None:
            self.call_from_thread(self.notify, "Select a calendar first", severity="warning")
            return
        start = datetime.combine(self.selected_date, datetime.min.time(), UTC)
        duration = {"Day": 1, "Week": 7, "Month": 35}.get(self.surface, 14)
        self.call_from_thread(self.start_loading, "Refreshing recurring instances")
        worker_storage: Storage | None = None
        try:
            engine = self.runtime.sync_engine(self.account_id)
            worker_storage = Storage(self.runtime.paths.database_file)
            engine.storage = worker_storage
            events = engine.refresh_occurrences(
                self.account_id, calendar_id, start, start + timedelta(days=duration)
            )
        except Exception as exc:
            self.call_from_thread(self.notify, f"Instance refresh failed: {exc}", severity="error")
        else:
            self.call_from_thread(self.notify, f"Refreshed {len(events)} recurring instances")
        finally:
            if worker_storage is not None:
                worker_storage.close()
            self.call_from_thread(self.stop_loading)
            self.call_from_thread(self.refresh_workspace)


def run_tui(runtime: Runtime | None = None, *, account: str | None = None) -> None:
    """Run the interactive product without performing an implicit sync."""
    HcbApp(runtime, account=account).run()
