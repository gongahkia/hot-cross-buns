"""Reusable Textual widgets and modal workflows for HCB."""

from __future__ import annotations

import asyncio
import json
import shlex
import subprocess
import webbrowser
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from time import monotonic
from typing import TYPE_CHECKING, Literal, cast

from rich.color import Color as RichColor
from rich.style import Style
from rich.text import Text
from textual import events, work
from textual._text_area_theme import TextAreaTheme
from textual.app import ComposeResult
from textual.binding import Binding
from textual.color import Color
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.geometry import Size
from textual.message import Message
from textual.screen import ModalScreen
from textual.scroll_view import ScrollView
from textual.strip import Strip
from textual.widgets import (
    Button,
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

from .application import (
    BatchActionPreview,
    BatchMovePreview,
)
from .config import ThemeColors
from .environment import LocalEnvironment
from .errors import HcbError
from .import_export import ImportPreview
from .loaders import LOADER_NAMES, loader_preset
from .models import ConflictStatus, DriveFile, Event, Task, TaskStatus
from .runtime import DEFAULT_CREDENTIAL_FILE
from .themes import preset, presets
from .tui import (
    BOOLEAN_OPTIONS,
    BORDER_OPTIONS,
    CURRENT_THEME_VALUE,
    DATE_TIME_FORMAT_OPTIONS,
    DENSITY_OPTIONS,
    DUE_DAY_OPTIONS,
    DUE_MONTH_OPTIONS,
    FOCUS_OPTIONS,
    GOOGLE_EVENT_COLORS,
    LOCATION_MAP_ICON,
    PALETTE_COMMANDS,
    PROFILE_OPTIONS,
    RECURRENCE_FREQUENCY_OPTIONS,
    SURFACES,
    TIME_ZONE_OPTIONS,
    WEEK_START_OPTIONS,
    google_maps_url,
    is_web_url,
    linkify_urls,
    recurrence_frequency,
    recurrence_summary,
    recurrence_with_frequency,
    render_readonly_markup,
    role_rich_style,
)

if TYPE_CHECKING:
    from .tui import HcbApp


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
        app = cast("HcbApp", self.app)
        if app.handle_emoji_key(self, event):
            return
        if app.handle_external_editor_key(self, event):
            return
        await super()._on_key(event)
        app.update_emoji_completion(self)

    def on_blur(self, event: events.Blur) -> None:
        cast("HcbApp", self.app).dismiss_emoji_completion(self)


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

    def __init__(
        self, label: str | Text, *, kind: str, item_id: str, action: str | None = None
    ) -> None:
        super().__init__(Label(linkify_urls(label), markup=False))
        self.kind = kind
        self.item_id = item_id
        self.palette_action = action


@dataclass(frozen=True, slots=True)
class WorkspaceRow:
    """A workspace record rendered by the virtual table."""

    kind: str
    item_id: str
    label: Text


class WorkspaceTable(ScrollView):
    """A virtual, mutable workspace list with stable entity identities.

    ``DataTable`` can efficiently paint large tables, but its public API has no
    ordered insertion operation. This line-api widget keeps the same interaction
    surface while allowing a local task or event mutation to repaint only the
    affected visible lines.
    """

    class LinkClicked(Message):
        """Posted when a safe Rich link in a workspace row is activated."""

        def __init__(self, table: WorkspaceTable, url: str) -> None:
            self.table = table
            self.url = url
            super().__init__()

    class RowMarked(Message):
        """Posted for Ctrl/Cmd-click selection without opening the item view."""

        def __init__(self, table: WorkspaceTable, row: WorkspaceRow) -> None:
            self.table = table
            self.row = row
            super().__init__()

    class RowHighlighted(Message):
        """Posted after keyboard or mouse navigation changes the active row."""

        def __init__(self, table: WorkspaceTable, row: WorkspaceRow, index: int) -> None:
            self.table = table
            self.row = row
            self.index = index
            super().__init__()

    class RowSelected(Message):
        """Posted after an active workspace row is opened."""

        def __init__(self, table: WorkspaceTable, row: WorkspaceRow, index: int) -> None:
            self.table = table
            self.row = row
            self.index = index
            super().__init__()

    BINDINGS = [
        Binding("enter", "select_cursor", "Select", show=False),
        Binding("up", "cursor_up", "Cursor up", show=False),
        Binding("down", "cursor_down", "Cursor down", show=False),
        Binding("pageup", "page_up", "Page up", show=False),
        Binding("pagedown", "page_down", "Page down", show=False),
        Binding("ctrl+home", "cursor_first", "First row", show=False),
        Binding("ctrl+end", "cursor_last", "Last row", show=False),
    ]

    def __init__(self, *, id: str = "content") -> None:
        super().__init__(id=id, can_focus=True)
        self._workspace_rows: list[WorkspaceRow] = []
        self._row_indexes: dict[tuple[str, str], int] = {}
        self._cursor_row = 0
        self._selected_row_index: int | None = None
        self._selection_style: Style | None = None
        self._row_height = 1
        self._content_width = 1
        self.virtual_size = Size(1, 0)

    def replace_rows(self, rows: tuple[WorkspaceRow, ...], *, height: int = 1) -> None:
        """Replace the projection after a deliberate full workspace refresh."""
        self._workspace_rows = list(rows)
        self._row_height = max(1, height)
        self._selected_row_index = None
        self._selection_style = None
        self._cursor_row = min(self._cursor_row, max(0, len(rows) - 1))
        self._reindex_rows()
        self._recalculate_virtual_size()
        self.refresh()

    @property
    def workspace_rows(self) -> tuple[WorkspaceRow, ...]:
        """The domain rows in their current visual order."""
        return tuple(self._workspace_rows)

    @property
    def row_count(self) -> int:
        """Return the number of logical workspace rows."""
        return len(self._workspace_rows)

    @property
    def cursor_row(self) -> int:
        """Return the current logical workspace-row index."""
        return self._cursor_row

    def row_at(self, index: int) -> WorkspaceRow | None:
        if not 0 <= index < len(self._workspace_rows):
            return None
        return self._workspace_rows[index]

    def index_of(self, kind: str, item_id: str) -> int | None:
        """Return the current projection index for a domain identity."""
        return self._row_indexes.get((kind, item_id))

    def update_workspace_row(self, index: int, row: WorkspaceRow) -> None:
        """Patch one row without invalidating the surrounding projection."""
        if not 0 <= index < len(self._workspace_rows):
            return
        previous = self._workspace_rows[index]
        self._workspace_rows[index] = row
        if (previous.kind, previous.item_id) != (row.kind, row.item_id):
            self._reindex_rows()
        self._refresh_width_after_change(previous, row)
        self._refresh_workspace_row(index)

    def insert_workspace_row(self, index: int, row: WorkspaceRow) -> None:
        """Insert one row in visual order and refresh only the viewport."""
        index = max(0, min(index, len(self._workspace_rows)))
        self._workspace_rows.insert(index, row)
        if index <= self._cursor_row:
            self._cursor_row += 1
        if self._selected_row_index is not None and index <= self._selected_row_index:
            self._selected_row_index += 1
        self._reindex_rows()
        self._content_width = max(self._content_width, row.label.cell_len)
        self._recalculate_virtual_size()
        self.refresh()

    def remove_workspace_row(self, index: int) -> WorkspaceRow | None:
        """Remove one row in visual order and refresh only the viewport."""
        if not 0 <= index < len(self._workspace_rows):
            return None
        removed = self._workspace_rows.pop(index)
        if self._cursor_row > index:
            self._cursor_row -= 1
        self._cursor_row = min(self._cursor_row, max(0, len(self._workspace_rows) - 1))
        if self._selected_row_index is not None:
            if self._selected_row_index == index:
                self._selected_row_index = None
            elif self._selected_row_index > index:
                self._selected_row_index -= 1
        self._reindex_rows()
        if removed.label.cell_len == self._content_width:
            self._recalculate_virtual_size()
        else:
            self.virtual_size = Size(
                self._content_width, len(self._workspace_rows) * self._row_height
            )
        self.refresh()
        return removed

    def select_workspace_row(self, index: int, style: Style) -> None:
        """Apply selection styling to only the outgoing and incoming rows."""
        if not 0 <= index < len(self._workspace_rows):
            return
        previous = self._selected_row_index
        if previous == index and self._selection_style == style:
            return
        self._selected_row_index = index
        self._selection_style = style
        if previous is not None and previous < len(self._workspace_rows):
            self._refresh_workspace_row(previous)
        self._refresh_workspace_row(index)

    def move_cursor(self, *, row: int, animate: bool = False) -> None:
        """Move the logical cursor and bring it into the visible viewport."""
        if not self._workspace_rows:
            return
        index = max(0, min(row, len(self._workspace_rows) - 1))
        previous = self._cursor_row
        self._cursor_row = index
        self._scroll_cursor_into_view(animate=animate)
        if previous != index:
            self.post_message(self.RowHighlighted(self, self._workspace_rows[index], index))

    def action_cursor_up(self) -> None:
        self.move_cursor(row=self._cursor_row - 1, animate=False)

    def action_cursor_down(self) -> None:
        self.move_cursor(row=self._cursor_row + 1, animate=False)

    def action_page_up(self) -> None:
        self.move_cursor(row=self._cursor_row - self._page_row_count, animate=False)

    def action_page_down(self) -> None:
        self.move_cursor(row=self._cursor_row + self._page_row_count, animate=False)

    def action_cursor_first(self) -> None:
        self.move_cursor(row=0, animate=False)

    def action_cursor_last(self) -> None:
        self.move_cursor(row=len(self._workspace_rows) - 1, animate=False)

    def action_select_cursor(self) -> None:
        row = self.row_at(self._cursor_row)
        if row is not None:
            self.post_message(self.RowSelected(self, row, self._cursor_row))

    @property
    def _page_row_count(self) -> int:
        return max(1, self.size.height // self._row_height)

    def _reindex_rows(self) -> None:
        self._row_indexes = {
            (row.kind, row.item_id): index for index, row in enumerate(self._workspace_rows)
        }

    def _recalculate_virtual_size(self) -> None:
        self._content_width = max((row.label.cell_len for row in self._workspace_rows), default=1)
        self.virtual_size = Size(self._content_width, len(self._workspace_rows) * self._row_height)

    def _refresh_width_after_change(self, previous: WorkspaceRow, row: WorkspaceRow) -> None:
        if (
            row.label.cell_len > self._content_width
            or previous.label.cell_len == self._content_width
        ):
            self._recalculate_virtual_size()

    def _refresh_workspace_row(self, index: int) -> None:
        self.refresh_lines(index * self._row_height, self._row_height)

    def _scroll_cursor_into_view(self, *, animate: bool) -> None:
        y = self._cursor_row * self._row_height
        scroll_y = int(self.scroll_offset.y)
        if y < scroll_y:
            self.scroll_to(y=y, animate=animate, immediate=True)
        elif y + self._row_height > scroll_y + self.size.height:
            self.scroll_to(
                y=y + self._row_height - self.size.height,
                animate=animate,
                immediate=True,
            )

    def _rendered_row_label(self, index: int) -> Text:
        label = self._workspace_rows[index].label.copy()
        inline_spans = label.spans[:]
        label.spans = []
        base_style = self.rich_style
        if index == self._selected_row_index and self._selection_style is not None:
            base_style = base_style + self._selection_style
            if base_style.reverse:
                # ``reverse`` swaps every foreground colour, including an event's
                # colour indicator. Materialize the reversal in the base style so
                # inline spans retain their intended foreground colour.
                base_style = base_style.without_color + Style(
                    color=base_style.bgcolor,
                    bgcolor=base_style.color,
                    reverse=False,
                )
        # Insert the base layer before existing Rich spans. A Text's ``style``
        # attribute is not emitted for unstyled segments, which breaks Textual's
        # monochrome filter, so use a full-width span instead.
        label.stylize(base_style)
        label.spans.extend(inline_spans)
        return label

    def render_line(self, y: int) -> Strip:
        """Render the requested viewport line without materializing other rows."""
        y += int(self.scroll_offset.y)
        if y < 0 or y >= self.virtual_size.height or y % self._row_height:
            return Strip.blank(self.size.width, self.rich_style)
        row_index = y // self._row_height
        label = self._rendered_row_label(row_index)
        return Strip(label.render(self.app.console)).crop_extend(
            int(self.scroll_offset.x),
            int(self.scroll_offset.x) + self.size.width,
            self.rich_style,
        )

    def on_click(self, event: events.Click) -> None:
        url = event.style.link
        if isinstance(url, str) and is_web_url(url):
            self.post_message(self.LinkClicked(self, url))
            event.stop()
            event.prevent_default()
            return
        row_index = int(event.offset.y + self.scroll_offset.y) // self._row_height
        if (
            (event.ctrl or event.meta)
            and (row := self.row_at(row_index)) is not None
            and row.kind in {"task", "event"}
        ):
            self.post_message(self.RowMarked(self, row))
            event.stop()
            event.prevent_default()
            return
        if self.row_at(row_index) is not None:
            self.move_cursor(row=row_index, animate=False)
            row = self._workspace_rows[row_index]
            self.post_message(self.RowSelected(self, row, row_index))
            event.stop()
            event.prevent_default()
            return


class TerminalTextArea(TextArea):
    """Use terminal-default Rich colors where Textual itself needs an opaque base style."""

    def on_mount(self) -> None:
        self.cursor_blink = False
        self.apply_terminal_theme()

    async def _on_key(self, event: events.Key) -> None:
        app = cast("HcbApp", self.app)
        if app.handle_emoji_key(self, event):
            return
        if app.handle_external_editor_key(self, event):
            return
        await super()._on_key(event)
        app.update_emoji_completion(self)

    def on_blur(self, event: events.Blur) -> None:
        cast("HcbApp", self.app).dismiss_emoji_completion(self)

    def apply_terminal_theme(self) -> None:
        colors = cast("HcbApp", self.app).runtime.config.theme.colors
        self.register_theme(
            TextAreaTheme(
                "hcb-terminal",
                base_style=Style(
                    color=self._rich_color(self._control_foreground(colors)),
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

    @staticmethod
    def _control_foreground(colors: ThemeColors) -> str:
        if colors.control in {"transparent", "ansi_default"}:
            return colors.text
        return Color.parse(colors.control).get_contrast_text(1.0).hex


type EmojiTarget = Input | TerminalTextArea
type EditorRunner = Callable[[list[str]], int]
type SuspendContext = Callable[[], AbstractContextManager[None]]
type UrlOpener = Callable[[str], bool]


def editor_file_hint(shortcut: str, file_label: str, editor: str) -> str:
    """Render a concise, human-readable external-editor affordance."""

    shortcut_label = "+".join(
        part.upper() if len(part) == 1 else part.capitalize() for part in shortcut.split("+")
    )
    return f"{shortcut_label} to open this {file_label} in {editor}"


def _run_editor(command: list[str]) -> int:
    return subprocess.run(command, check=False).returncode


def _open_url(url: str) -> bool:
    return webbrowser.open(url, new=2)


class RattlesLoader(Static):
    """Animate the configured Rattles preset using its source timing."""

    def __init__(self) -> None:
        super().__init__(id="rattles-loader")
        self._started_at = monotonic()

    def on_mount(self) -> None:
        self._render_frame()
        self.set_interval(0.05, self._render_frame)

    def _render_frame(self) -> None:
        app = cast("HcbApp", self.app)
        preset = loader_preset(app.runtime.config.theme.loader)
        self.update(preset.frame_at(monotonic() - self._started_at))


class LoadingScreen(ModalScreen[None]):
    """Progress surface shared by explicit remote TUI operations."""

    BINDINGS = [Binding("escape", "cancel_sync", "Cancel sync")]

    def __init__(self, message: str, *, cancellable: bool = False) -> None:
        super().__init__()
        self.message = message
        self.cancellable = cancellable

    def compose(self) -> ComposeResult:
        with Vertical(id="loading-dialog"):
            yield RattlesLoader()
            yield Label(self.message, id="loading-message")
            if self.cancellable:
                yield Label("Press Esc to cancel safely", id="loading-cancel-hint")

    def set_message(self, message: str) -> None:
        self.message = message
        self.query_one("#loading-message", Label).update(message)

    def action_cancel_sync(self) -> None:
        if self.cancellable:
            cast("HcbApp", self.app).cancel_sync()


class HelpScreen(ModalScreen[None]):
    """Show every active user-configurable binding in one read-only dialog."""

    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, hcb: HcbApp) -> None:
        super().__init__()
        self.hcb = hcb

    def compose(self) -> ComposeResult:
        keys = self.hcb.runtime.config.keys
        sections = (
            (
                "Workspace",
                (
                    ("Quit", keys.quit),
                    ("Help", keys.help),
                    ("Command palette", keys.search),
                    ("Sync", keys.sync),
                    ("Create", keys.create),
                    ("Edit", keys.edit),
                    ("Delete", keys.delete),
                    ("Complete", keys.complete),
                    ("Jump to date", keys.jump),
                    ("Mark", keys.mark),
                    ("RSVP", keys.rsvp),
                    ("Undo", keys.undo),
                    ("Redo", keys.redo),
                ),
            ),
            (
                "Views",
                (
                    ("Tasks", keys.tasks),
                    ("Notes", keys.notes),
                    ("Agenda", keys.agenda),
                    ("Day", keys.day),
                    ("Week", keys.week),
                    ("Month", keys.month),
                    ("Narrow sidebar", keys.resize_sidebar_narrower),
                    ("Widen sidebar", keys.resize_sidebar_wider),
                ),
            ),
            (
                "Editors and dialogs",
                (
                    ("External editor", keys.external_editor),
                    ("Edit", keys.modal_edit),
                    ("Delete", keys.modal_delete),
                    ("Confirm", keys.modal_confirm),
                    ("Cancel", keys.modal_cancel),
                ),
            ),
        )
        lines = [
            f"{heading}\n" + "\n".join(f"{key:<24} {value}" for key, value in entries)
            for heading, entries in sections
        ]
        with Vertical(id="help-dialog"):
            yield Label("Keyboard shortcuts", id="dialog-title")
            with VerticalScroll(id="help-content"):
                yield Static("\n\n".join(lines))
                yield Static(
                    "Escape always closes a dialog. Textual's Ctrl+Q safety quit remains "
                    "available.",
                    classes="item-view-section",
                )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Close", id="help-close")

    def action_close(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "help-close":
            self.action_close()


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
        deletable: bool = False,
    ) -> None:
        super().__init__()
        self.initial_title = title
        self.initial_notes = notes
        self.initial_due = due
        self.jump = jump
        self.deletable = deletable
        self._initial_due_date = date.fromisoformat(due) if due else None

    def _due_year_options(self) -> tuple[tuple[str, str], ...]:
        current_year = date.today().year
        initial_year = self._initial_due_date.year if self._initial_due_date else current_year
        start = min(current_year - 5, initial_year)
        end = max(current_year + 10, initial_year)
        return tuple((str(year), str(year)) for year in range(start, end + 1))

    def compose(self) -> ComposeResult:
        with Vertical(id="editor-dialog"):
            yield Label("Jump to date" if self.jump else "Task editor", id="dialog-title")
            yield Input(
                value=self.initial_due if self.jump else self.initial_title,
                placeholder="YYYY-MM-DD" if self.jump else "Task title",
                id="editor-title",
            )
            if not self.jump:
                with Horizontal(classes="due-date-fields"):
                    yield Select(
                        DUE_DAY_OPTIONS,
                        prompt="Day",
                        value=(
                            str(self._initial_due_date.day)
                            if self._initial_due_date
                            else Select.NULL
                        ),
                        id="editor-due-day",
                    )
                    yield Select(
                        DUE_MONTH_OPTIONS,
                        prompt="Month",
                        value=(
                            str(self._initial_due_date.month)
                            if self._initial_due_date
                            else Select.NULL
                        ),
                        id="editor-due-month",
                    )
                    yield Select(
                        self._due_year_options(),
                        prompt="Year",
                        value=(
                            str(self._initial_due_date.year)
                            if self._initial_due_date
                            else Select.NULL
                        ),
                        id="editor-due-year",
                    )
                yield TerminalTextArea(self.initial_notes, id="editor-notes")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Go" if self.jump else "Save", variant="primary", id="save")
                if self.deletable:
                    yield Button("Delete", variant="error", id="delete")
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
            "due": self._due_value(),
            "notes": self.query_one("#editor-notes", TextArea).text,
        }

    def _due_value(self) -> str:
        day_value = self.query_one("#editor-due-day", Select).value
        month_value = self.query_one("#editor-due-month", Select).value
        year_value = self.query_one("#editor-due-year", Select).value
        values = (day_value, month_value, year_value)
        if all(value is Select.NULL for value in values):
            return ""
        if not all(isinstance(value, str) for value in values):
            raise ValueError("Choose a day, month, and year, or clear all due-date fields")
        assert isinstance(day_value, str)
        assert isinstance(month_value, str)
        assert isinstance(year_value, str)
        day, month, year = int(day_value), int(month_value), int(year_value)
        return date(year, month, day).isoformat()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if self.jump:
            self.dismiss(self._result())

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "delete":
            self.dismiss({"action": "delete"})
            return
        if event.button.id != "save":
            self.dismiss(None)
            return
        try:
            self.dismiss(self._result())
        except ValueError as exc:
            self.notify(str(exc), severity="error")


class ConfirmScreen(ModalScreen[bool]):
    BINDINGS = [
        Binding("escape", "cancel", "Cancel"),
        Binding("y", "confirm", "Confirm", id="modal_confirm"),
        Binding("n", "cancel", "Cancel", id="modal_cancel"),
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

    def __init__(
        self,
        environment: LocalEnvironment,
        *,
        credential_file: Path = DEFAULT_CREDENTIAL_FILE,
        credential_file_suggestions: tuple[Path, ...] = (),
        editor_command: str = "nvim",
        external_editor_shortcut: str = "ctrl+g",
    ) -> None:
        super().__init__()
        self.environment = environment
        self.credential_file = credential_file
        self.credential_file_suggestions = credential_file_suggestions
        self.editor_command = editor_command
        self.external_editor_shortcut = external_editor_shortcut

    def _credential_editor_hint(self) -> str:
        return editor_file_hint(
            self.external_editor_shortcut, "credential file", self.editor_command
        )

    @staticmethod
    def _display_credential_file(path: Path) -> str:
        expanded = path.expanduser()
        try:
            return f"~/{expanded.relative_to(Path.home())}"
        except ValueError:
            return str(expanded)

    def _credential_file_options(self) -> tuple[tuple[str, str], ...]:
        candidates = (self.credential_file, *self.credential_file_suggestions)
        paths: list[Path] = []
        seen: set[Path] = set()
        for candidate in candidates:
            resolved = candidate.expanduser().resolve(strict=False)
            if resolved not in seen:
                seen.add(resolved)
                paths.append(resolved)
        return tuple(
            (
                f"{'Suggested' if index == 0 else 'Detected'} · "
                f"{self._display_credential_file(path)}",
                str(path),
            )
            for index, path in enumerate(paths)
        )

    def _theme_options(self) -> tuple[tuple[str, str], ...]:
        detected = self.environment.suggested_preset
        options: list[tuple[str, str]] = [("Keep terminal defaults", "terminal")]
        if detected:
            options.append((f"Use detected {detected}", detected))
        options.extend((item.name, item.name) for item in presets() if item.name != detected)
        return tuple(options)

    def _appearance_notification(self) -> str:
        theme = self.environment.terminal_theme
        if self.environment.suggested_preset:
            return (
                f"Detected {theme} in {self.environment.terminal_name}. "
                f"Use detected {self.environment.suggested_preset} is available under Appearance."
            )
        if theme:
            return (
                f"Detected {theme} in {self.environment.terminal_name}, but HCB has no matching "
                "bundled palette."
            )
        return "No named terminal theme detected. Appearance remains optional."

    def on_mount(self) -> None:
        self.notify(self._appearance_notification(), timeout=8)

    def compose(self) -> ComposeResult:
        with Vertical(id="onboarding-dialog"):
            yield Label("Welcome to Hot Cross Buns", id="dialog-title")
            with VerticalScroll(id="onboarding-fields"):
                with Vertical(classes="onboarding-credential-field"):
                    with Horizontal(classes="onboarding-field"):
                        yield Label("Credential .env path")
                        yield Input(
                            value=self._display_credential_file(self.credential_file),
                            placeholder="Credential .env path",
                            id="onboard-env-file",
                        )
                    yield Label(self._credential_editor_hint(), id="onboard-env-editor-hint")
                with Horizontal(classes="onboarding-field"):
                    yield Label("Suggested .env files")
                    yield Select(
                        self._credential_file_options(),
                        allow_blank=False,
                        value=str(self.credential_file.expanduser().resolve(strict=False)),
                        id="onboard-env-file-suggestion",
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
                with Horizontal(classes="onboarding-field"):
                    yield Label("Appearance")
                    yield Select(
                        self._theme_options(),
                        allow_blank=False,
                        value="terminal",
                        id="onboard-theme",
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
                "theme_preset": self._selected_value("#onboard-theme", "an appearance"),
                "connect": str(event.button.id == "onboard-connect").lower(),
            }
        )

    def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id != "onboard-env-file-suggestion" or not isinstance(event.value, str):
            return
        self.query_one("#onboard-env-file", Input).value = self._display_credential_file(
            Path(event.value)
        )

    def _selected_value(self, selector: str, label: str) -> str:
        value = self.query_one(selector, Select).value
        if not isinstance(value, str):
            raise ValueError(f"select {label}")
        return value


class GoogleSetupScreen(ModalScreen[None]):
    """Explain how to recover from an unavailable Google connection."""

    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(
        self,
        *,
        operation: str,
        account_id: str,
        email: str,
        credential_file: Path,
        reason: str,
    ) -> None:
        super().__init__()
        self.operation = operation
        self.account_id = account_id
        self.email = email
        self.credential_file = credential_file
        self.reason = reason

    def compose(self) -> ComposeResult:
        credential_path = str(self.credential_file)
        command = " ".join(
            (
                "hcb",
                "--env-file",
                shlex.quote(credential_path),
                "auth",
                "connect",
                shlex.quote(self.account_id),
                shlex.quote(self.email),
            )
        )
        with Vertical(id="google-setup-dialog"):
            yield Label("Google connection required", id="dialog-title")
            with VerticalScroll(id="google-setup-content"):
                yield Static(
                    f"{self.operation} did not start because HCB could not use the Google "
                    f"connection for {self.account_id!r}.\n\n"
                    f"Details: {self.reason}\n\n"
                    "To fix it:\n"
                    "1. In Google Cloud, create a Desktop OAuth client and enable the Google "
                    "Calendar, Tasks, and Drive APIs.\n"
                    f"2. Add its client ID to {credential_path}:\n"
                    "   HCB_GOOGLE_CLIENT_ID=...apps.googleusercontent.com\n"
                    "   HCB_GOOGLE_CLIENT_SECRET=...  # optional for Desktop clients\n"
                    f"3. Secure the file: chmod 600 {shlex.quote(credential_path)}\n"
                    "4. In a terminal, connect this account:\n"
                    f"   {command}\n\n"
                    "Approve the browser request, return here, and try again. When running HCB "
                    "from this source checkout, prefix the command with `uv run`.",
                    id="google-setup-guidance",
                )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Close", variant="primary", id="google-setup-close")

    def action_close(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "google-setup-close":
            self.dismiss(None)


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
            yield Button("Move marked tasks…", id="bulk-move-tasks")
            yield Button("RSVP to marked events", id="bulk-rsvp")
            yield Button("Move marked events…", id="bulk-move-events")
            yield Button("Delete marked…", variant="error", id="bulk-delete")
            yield Button("Close", id="bulk-close")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "bulk-close":
            self.dismiss(None)
        elif event.button.id == "bulk-complete":
            self.dismiss(None)
            self.hcb.action_complete()
        elif event.button.id == "bulk-move-tasks":
            self.dismiss(None)
            self.hcb.action_move_marked("task")
        elif event.button.id == "bulk-delete":
            self.dismiss(None)
            self.hcb.action_delete()
        elif event.button.id == "bulk-rsvp":
            self.dismiss(None)
            self.hcb.action_rsvp()
        elif event.button.id == "bulk-move-events":
            self.dismiss(None)
            self.hcb.action_move_marked("event")


class BatchActionScreen(ModalScreen[None]):
    """Show an exact local batch transformation before applying it."""

    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(self, hcb: HcbApp, preview: BatchActionPreview) -> None:
        super().__init__()
        self.hcb = hcb
        self.preview = preview

    def compose(self) -> ComposeResult:
        action_labels = {
            "complete": "Complete",
            "reopen": "Reopen",
            "delete": "Delete",
            "respond": "Queue RSVP",
        }
        label = action_labels[self.preview.action]
        with Vertical(id="batch-action-dialog"):
            yield Label(f"Review batch {self.preview.action}", id="dialog-title")
            yield Label(
                f"{len(self.preview.items)} selected {self.preview.entity_type}(s). "
                "Nothing changes until you apply this plan."
            )
            with VerticalScroll(id="batch-action-preview"):
                yield Static(
                    self.hcb.batch_action_preview_text(self.preview),
                    id="batch-action-summary",
                )
            with Horizontal(classes="dialog-buttons"):
                yield Button(
                    label,
                    variant="error" if self.preview.action == "delete" else "primary",
                    id="batch-action-apply",
                )
                yield Button("Cancel", id="batch-action-cancel")

    def action_close(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "batch-action-cancel":
            self.dismiss(None)
            return
        if event.button.id != "batch-action-apply":
            return
        if self.hcb.apply_batch_action(self.preview):
            self.dismiss(None)


class BatchMoveScreen(ModalScreen[None]):
    """Review a complete local move plan before enqueueing its serial mutations."""

    BINDINGS = [Binding("escape", "close", "Close")]

    def __init__(
        self, hcb: HcbApp, entity_type: Literal["task", "event"], item_ids: tuple[str, ...]
    ) -> None:
        super().__init__()
        self.hcb = hcb
        self.entity_type = entity_type
        self.item_ids = item_ids
        self.preview: BatchMovePreview | None = None

    def compose(self) -> ComposeResult:
        if self.entity_type == "task":
            options = tuple((label, item_id) for item_id, label in self.hcb.cache.task_lists)
            title = "Move marked tasks"
            prompt = "Destination task list"
        else:
            options = tuple(
                (label, item_id) for item_id, label, _selected in self.hcb.cache.calendars
            )
            title = "Move marked events"
            prompt = "Destination calendar"
        with Vertical(id="batch-move-dialog"):
            yield Label(title, id="dialog-title")
            yield Label(f"{len(self.item_ids)} selected {self.entity_type}(s)")
            yield Select(
                options,
                prompt=prompt,
                allow_blank=False,
                id="batch-move-destination",
            )
            with VerticalScroll(id="batch-move-preview"):
                yield Static(
                    "Choose a destination, then review the exact local plan. "
                    "Nothing changes until you confirm.",
                    id="batch-move-summary",
                )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Review move", variant="primary", id="batch-move-review")
                yield Button("Confirm move", disabled=True, id="batch-move-confirm")
                yield Button("Cancel", id="batch-move-cancel")

    def action_close(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "batch-move-cancel":
            self.dismiss(None)
            return
        if event.button.id not in {"batch-move-review", "batch-move-confirm"}:
            return
        if self.hcb.account_id is None:
            return
        destination = self.query_one("#batch-move-destination", Select).value
        if not isinstance(destination, str):
            self.notify("Choose a destination first", severity="warning")
            return
        if event.button.id == "batch-move-review":
            try:
                self.preview = (
                    self.hcb.runtime.application.preview_task_move(
                        self.hcb.account_id, list(self.item_ids), destination
                    )
                    if self.entity_type == "task"
                    else self.hcb.runtime.application.preview_event_move(
                        self.hcb.account_id, list(self.item_ids), destination
                    )
                )
            except (ValueError, HcbError) as exc:
                self.notify(str(exc), severity="error")
                return
            self.query_one("#batch-move-summary", Static).update(
                self.hcb.batch_move_preview_text(self.preview)
            )
            self.query_one("#batch-move-confirm", Button).disabled = False
            return
        if self.preview is None or self.preview.destination_id != destination:
            self.notify("Review the updated destination before confirming", severity="warning")
            return
        try:
            if self.entity_type == "task":
                self.hcb.runtime.application.move_tasks(
                    self.hcb.account_id, list(self.item_ids), destination
                )
            else:
                self.hcb.runtime.application.move_events(
                    self.hcb.account_id, list(self.item_ids), destination
                )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self.hcb.refresh_workspace()
        self.hcb.notify(f"Queued move for {len(self.item_ids)} {self.entity_type}(s)")
        self.dismiss(None)


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
            yield Label(
                editor_file_hint(
                    self.hcb.runtime.config.keys.external_editor,
                    "import file",
                    self.hcb._editor_command(),
                ),
                id="import-editor-hint",
            )
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
        self._initial_recurrence = event.recurrence if event else ()

    def _frequency(self) -> str:
        value = self.query_one("#event-frequency", Select).value
        return str(value) if isinstance(value, str) else "none"

    def _recurrence(self) -> tuple[str, ...]:
        frequency = self._frequency()
        if frequency == "custom":
            raw = self.query_one("#event-recurrence", Input).value
            return tuple(item.strip() for item in raw.split("|") if item.strip())
        return recurrence_with_frequency(self._initial_recurrence, frequency)

    def _update_recurrence_fields(self) -> None:
        frequency = self._frequency()
        recurrence = self._recurrence()
        self.query_one("#event-recurrence-summary", Static).update(
            f"Recurrence: {recurrence_summary(recurrence)}"
        )
        self.query_one("#event-recurrence", Input).display = frequency == "custom"

    def _update_location_map(self) -> None:
        location = self.query_one("#event-location", Input).value
        target = google_maps_url(location)
        link = self.query_one("#event-location-map", Static)
        link.display = target is not None
        if target is None:
            return
        text = Text(f"{LOCATION_MAP_ICON} {location.strip()}")
        text.stylize(Style(link=target, underline=True), 0, len(text))
        link.update(text)

    def compose(self) -> ComposeResult:
        event = self.event
        with Vertical(id="event-dialog"):
            yield Label("Event editor", id="dialog-title")
            with VerticalScroll(id="event-fields"):
                yield Input(
                    value=event.summary if event else "", placeholder="Title", id="event-title"
                )
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
                yield Static(id="event-location-map")
                yield Label("Frequency", classes="event-field-label")
                yield Select(
                    RECURRENCE_FREQUENCY_OPTIONS,
                    value=recurrence_frequency(self._initial_recurrence),
                    id="event-frequency",
                )
                yield Static(id="event-recurrence-summary")
                yield Input(
                    value=" | ".join(self._initial_recurrence),
                    placeholder="Custom recurrence rules, separated by |",
                    id="event-recurrence",
                )
                yield Label("Description", classes="event-field-label")
                yield TerminalTextArea(
                    event.description or "" if event else "", id="event-description"
                )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Save", variant="primary", id="event-save")
                if event is not None:
                    yield Button("Delete", variant="error", id="event-delete")
                yield Button("Cancel", id="event-cancel")

    def on_mount(self) -> None:
        self.query_one("#event-title", Input).focus()
        self._update_recurrence_fields()
        self._update_location_map()

    def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id == "event-frequency":
            self._update_recurrence_fields()

    def on_input_changed(self, event: TextualInput.Changed) -> None:
        if event.input.id == "event-location":
            self._update_location_map()

    def action_cancel(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "event-delete":
            self.dismiss({"action": "delete"})
            return
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
                "recurrence": " | ".join(self._recurrence()),
                "description": self.query_one("#event-description", TextArea).text,
            }
        )


class ItemViewScreen(ModalScreen[str | None]):
    """Read-only detail view for workspace items before an explicit edit action."""

    BINDINGS = [
        Binding("e", "edit", "Edit", id="modal_edit"),
        Binding("d", "delete", "Delete", id="modal_delete"),
        Binding("escape", "close", "Close"),
    ]

    class ContentReady(Message):
        """Deliver rich, non-essential detail content from the parser worker."""

        def __init__(self, screen: ItemViewScreen, sections: tuple[tuple[str, Text], ...]) -> None:
            self.screen = screen
            self.sections = sections
            super().__init__()

    def __init__(self, hcb: HcbApp, item: Task | Event | DriveFile) -> None:
        super().__init__()
        self.hcb = hcb
        self.item = item

    def _append_attachment(self, text: Text, attachment: dict[str, object]) -> None:
        title = str(attachment.get("title") or attachment.get("fileId") or "Attachment")
        url = next(
            (
                value
                for key in ("fileUrl", "webViewLink", "url")
                if isinstance((value := attachment.get(key)), str)
                if is_web_url(value)
            ),
            None,
        )
        text.append("• ")
        start = len(text)
        text.append(title)
        if url is not None:
            text.stylize(
                role_rich_style(self.hcb.runtime.config.theme.roles.link, link=url),
                start,
                len(text),
            )
        text.append("\n")

    def _task_details(self, task: Task) -> Text:
        text = Text(
            f"Due: {self.hcb.format_date(task.due) if task.due else '—'}\n"
            f"Priority: {task.priority.value}"
        )
        if task.completed_at is not None:
            text.append(f"\nCompleted: {self.hcb.format_date_time(task.completed_at)}")
        return text

    def _task_title(self, task: Task) -> Text:
        title = render_readonly_markup(
            task.title, link_style=role_rich_style(self.hcb.runtime.config.theme.roles.link)
        )
        if task.status is TaskStatus.COMPLETED:
            title.stylize(role_rich_style(self.hcb.runtime.config.theme.roles.completed_item))
        return title

    def _event_color(self, event: Event) -> str | None:
        color = event.color_id
        if color is None:
            calendar = self.hcb.runtime.storage.get_calendar(event.account_id, event.calendar_id)
            color = calendar.color if calendar is not None else None
        if color is None:
            return None
        return GOOGLE_EVENT_COLORS.get(color) or (color if color.startswith("#") else None)

    @staticmethod
    def _reminder_offset(minutes: int) -> str:
        days, remainder = divmod(minutes, 24 * 60)
        hours, minutes = divmod(remainder, 60)
        parts = []
        if days:
            parts.append(f"{days} day" + ("s" if days != 1 else ""))
        if hours:
            parts.append(f"{hours} hr")
        if minutes or not parts:
            parts.append(f"{minutes} min")
        return " ".join(parts)

    @staticmethod
    def _conference_url(conference: dict[str, object]) -> str | None:
        entry_points = conference.get("entryPoints")
        if not isinstance(entry_points, list):
            return None
        return next(
            (
                uri
                for point in entry_points
                if isinstance(point, dict)
                if isinstance((uri := point.get("uri")), str)
                if is_web_url(uri)
            ),
            None,
        )

    def _event_core_details(self, event: Event) -> Text:
        reminders = (
            "Default reminders"
            if event.reminder_use_default
            else ", ".join(
                f"{item.method} {self._reminder_offset(item.minutes)}"
                for item in event.reminder_overrides
            )
            or "No reminders"
        )
        text = Text(
            f"When: {self.hcb.format_date_time(event.start.value)} → "
            f"{self.hcb.format_date_time(event.end.value)}\n"
            f"Repeats: {recurrence_summary(event.recurrence)}\n"
            f"Reminders: {reminders}"
        )
        if color := self._event_color(event):
            text.append("\nColor: ")
            text.append("●", style=Style(color=color))
        if event.conference:
            text.append("\nConference: ")
            if url := self._conference_url(event.conference):
                start = len(text)
                text.append("Open meeting")
                text.stylize(
                    role_rich_style(self.hcb.runtime.config.theme.roles.link, link=url),
                    start,
                    len(text),
                )
            else:
                text.append("available")
        permissions = tuple(
            (label, value)
            for label, value in (
                ("invite", event.guests_can_invite_others),
                ("modify", event.guests_can_modify),
                ("see", event.guests_can_see_other_guests),
            )
            if value is not None
        )
        if permissions:
            text.append("\nGuest permissions: ")
            text.append(
                ", ".join(f"{label}={'yes' if value else 'no'}" for label, value in permissions)
            )
        return text

    def _event_additional_details(self, event: Event) -> Text:
        text = Text()
        if event.attendees:
            text.append("\n\nAttendees:")
            for attendee in event.attendees:
                name = attendee.get("displayName") or attendee.get("email") or "Guest"
                response = attendee.get("responseStatus")
                text.append(f"\n• {name}" + (f" · {response}" if response else ""))
        if event.attachments:
            text.append("\n\nAttachments:\n")
            for attachment in event.attachments:
                self._append_attachment(text, attachment)
        properties = (
            event.focus_time_properties
            or event.out_of_office_properties
            or event.working_location_properties
        )
        if properties:
            text.append(f"\nProperties:\n{json.dumps(properties, indent=2, sort_keys=True)}")
        return text

    def _event_details(self, event: Event) -> Text:
        """Return the complete event detail text for callers needing it synchronously."""
        text = self._event_core_details(event)
        text.append_text(self._event_additional_details(event))
        return text

    async def _load_markup_progressively(
        self, section_id: str, value: str, link_style: Style
    ) -> None:
        """Yield between bounded Markdown chunks so a large body cannot monopolize the UI."""
        if "<" in value and ">" in value:
            # HTML needs one parser pass to retain tag nesting. Yield once so the
            # dialog can paint before that less-common, potentially large pass.
            await asyncio.sleep(0)
            self.post_message(
                self.ContentReady(
                    self,
                    (
                        (
                            section_id,
                            render_readonly_markup(
                                value or "No description", link_style=link_style
                            ),
                        ),
                    ),
                )
            )
            return
        lines = value.splitlines(keepends=True) or [value]
        rendered = Text()
        for start in range(0, len(lines), 64):
            chunk = "".join(lines[start : start + 64])
            rendered.append_text(render_readonly_markup(chunk, link_style=link_style))
            if (start // 64 + 1) % 4 == 0 or start + 64 >= len(lines):
                self.post_message(self.ContentReady(self, ((section_id, rendered.copy()),)))
            await asyncio.sleep(0)

    @work(group="item-view-content", exit_on_error=False)
    async def _load_deferred_content(self) -> None:
        """Populate non-essential detail content after the read-only card is visible."""
        link_style = role_rich_style(self.hcb.runtime.config.theme.roles.link)
        item = self.item
        if isinstance(item, Task):
            await self._load_markup_progressively(
                "item-view-notes", item.notes or "No notes", link_style
            )
        elif isinstance(item, Event):
            self.post_message(
                self.ContentReady(
                    self, (("item-view-extra", self._event_additional_details(item)),)
                )
            )
            await self._load_markup_progressively(
                "item-view-description", item.description or "No description", link_style
            )
        else:
            return

    def compose(self) -> ComposeResult:
        item = self.item
        title = "Task" if isinstance(item, Task) else "Event" if isinstance(item, Event) else "File"
        with Vertical(id="item-view-dialog"):
            yield Label(title, id="dialog-title")
            with VerticalScroll(id="item-view-content"):
                if isinstance(item, Task):
                    yield Static(self._task_title(item), id="item-view-title")
                    yield Static(self._task_details(item), classes="item-view-section")
                    yield Label("Notes", classes="event-field-label")
                    yield Static(
                        "Loading notes…", id="item-view-notes", classes="item-view-section"
                    )
                elif isinstance(item, Event):
                    yield Static(
                        render_readonly_markup(
                            item.summary,
                            link_style=role_rich_style(self.hcb.runtime.config.theme.roles.link),
                        ),
                        id="item-view-title",
                    )
                    yield Static(self._event_core_details(item), classes="item-view-section")
                    yield Static("Loading additional details…", id="item-view-extra")
                    if location := google_maps_url(item.location or ""):
                        text = Text(f"{LOCATION_MAP_ICON} {item.location}")
                        text.stylize(
                            role_rich_style(
                                self.hcb.runtime.config.theme.roles.link, link=location
                            ),
                            0,
                            len(text),
                        )
                        yield Static(text, classes="item-view-location")
                    yield Label("Description", classes="event-field-label")
                    yield Static(
                        "Loading description…",
                        id="item-view-description",
                        classes="item-view-section",
                    )
                else:
                    yield Static(
                        render_readonly_markup(
                            item.name,
                            link_style=role_rich_style(self.hcb.runtime.config.theme.roles.link),
                        ),
                        id="item-view-title",
                    )
                    modified = (
                        self.hcb.format_date_time(item.modified_time) if item.modified_time else "—"
                    )
                    yield Static(
                        f"Type: {item.mime_type or 'unknown'}\nModified: {modified}",
                        classes="item-view-section",
                    )
                    if item.web_view_link:
                        yield Static(
                            linkify_urls(
                                item.web_view_link,
                                link_style=role_rich_style(
                                    self.hcb.runtime.config.theme.roles.link
                                ),
                            ),
                            classes="item-view-section",
                        )
            with Horizontal(classes="dialog-buttons"):
                if not isinstance(item, DriveFile):
                    yield Button("Edit", variant="primary", id="item-view-edit")
                    yield Button("Delete", variant="error", id="item-view-delete")
                yield Button("Close", id="item-view-close")

    def on_mount(self) -> None:
        role = self.hcb.runtime.config.theme.roles.modal_title
        title = self.query_one("#dialog-title", Label)
        if role.color not in {None, "ansi_default", "transparent"}:
            title.styles.color = role.color
        if role.background not in {None, "ansi_default", "transparent"}:
            title.styles.background = role.background
        title.styles.text_style = role.text_style
        if not isinstance(self.item, DriveFile):
            self._load_deferred_content()

    def on_item_view_screen_content_ready(self, event: ContentReady) -> None:
        if event.screen is not self:
            return
        for section_id, content in event.sections:
            self.query_one(f"#{section_id}", Static).update(content)
        extra = self.query_one("#item-view-extra", Static) if isinstance(self.item, Event) else None
        if extra is not None:
            extra.display = bool(extra.content)

    def on_unmount(self) -> None:
        self.workers.cancel_group(self, "item-view-content")

    def action_edit(self) -> None:
        if not isinstance(self.item, DriveFile):
            self.dismiss("edit")

    def action_delete(self) -> None:
        if not isinstance(self.item, DriveFile):
            self.dismiss("delete")

    def action_close(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "item-view-edit":
            self.action_edit()
        elif event.button.id == "item-view-delete":
            self.action_delete()
        else:
            self.action_close()


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
            with VerticalScroll(id="settings-fields"):
                with Horizontal(classes="settings-pair"):
                    yield Select(
                        self._theme_options(),
                        allow_blank=False,
                        prompt="Theme palette",
                        value=values["theme_preset"],
                        id="setting-theme",
                    )
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
                    yield Select(
                        DATE_TIME_FORMAT_OPTIONS,
                        allow_blank=False,
                        prompt="Date and time display",
                        value=values["date_time_format"],
                        id="setting-date-time-format",
                    )
                    yield Select(
                        [(name, name) for name in LOADER_NAMES],
                        allow_blank=False,
                        prompt="Loading indicator",
                        value=values["loader"],
                        id="setting-loader",
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
                yield Label("Semantic colors (strict JSON object)", id="settings-colors-label")
                yield TerminalTextArea(values["colors"], id="settings-colors")
                yield Label("Semantic roles (strict JSON object)")
                yield TerminalTextArea(values["roles"], id="settings-roles")
                yield Input(
                    value=values["stylesheet"],
                    placeholder="Profile TCSS stylesheet path",
                    id="setting-stylesheet",
                )
                yield Label("Behavior")
                with Horizontal(classes="settings-pair"):
                    yield Input(
                        value=values["time_zone"],
                        placeholder="IANA time zone",
                        id="setting-time-zone",
                    )
                    yield Select(
                        BOOLEAN_OPTIONS,
                        value=values["reminders_enabled"],
                        allow_blank=False,
                        prompt="Reminders",
                        id="setting-reminders",
                    )
                    yield Input(
                        value=values["reminder_poll_seconds"],
                        placeholder="Reminder poll seconds",
                        id="setting-reminder-poll",
                    )
                with Horizontal(classes="settings-pair"):
                    yield Input(
                        value=values["reminder_catch_up_minutes"],
                        placeholder="Reminder catch-up minutes",
                        id="setting-reminder-catch-up",
                    )
                    yield Input(
                        value=values["reminder_jitter_seconds"],
                        placeholder="Reminder jitter seconds",
                        id="setting-reminder-jitter",
                    )
                    yield Input(
                        value=values["reminder_sync_interval_minutes"],
                        placeholder="Reminder sync interval minutes",
                        id="setting-reminder-sync-interval",
                    )
                    yield Select(
                        (
                            ("Sync all", "all"),
                            ("Pull only", "pull"),
                            ("Do not sync", "off"),
                        ),
                        value=values["reminder_sync_mode"],
                        allow_blank=False,
                        prompt="Reminder sync mode",
                        id="setting-reminder-sync-mode",
                    )
                with Horizontal(classes="settings-pair"):
                    yield Input(
                        value=values["default_account_id"],
                        placeholder="Default account",
                        id="setting-default-account",
                    )
                    yield Input(
                        value=values["default_task_list_id"],
                        placeholder="Default task list",
                        id="setting-default-list",
                    )
                    yield Input(
                        value=values["default_calendar_id"],
                        placeholder="Default calendar",
                        id="setting-default-calendar",
                    )
                yield Label("Capture")
                with Horizontal(classes="settings-pair"):
                    yield Input(
                        value=values["capture_duration"],
                        placeholder="Event duration minutes",
                        id="setting-capture-duration",
                    )
                    yield Select(
                        BOOLEAN_OPTIONS,
                        value=values["capture_remove"],
                        allow_blank=False,
                        prompt="Remove recognized text",
                        id="setting-capture-remove",
                    )
                for label, value, field_id in (
                    (
                        "Task aliases",
                        values["capture_task_aliases"],
                        "setting-capture-task-aliases",
                    ),
                    (
                        "Event aliases",
                        values["capture_event_aliases"],
                        "setting-capture-event-aliases",
                    ),
                    (
                        "High-priority aliases",
                        values["capture_high_aliases"],
                        "setting-capture-high-aliases",
                    ),
                    (
                        "Medium-priority aliases",
                        values["capture_medium_aliases"],
                        "setting-capture-medium-aliases",
                    ),
                    (
                        "Low-priority aliases",
                        values["capture_low_aliases"],
                        "setting-capture-low-aliases",
                    ),
                ):
                    yield Input(value=value, placeholder=label, id=field_id)
                yield Label("Keymap (strict JSON object)")
                yield TerminalTextArea(values["keys"], id="settings-keys")
                yield Label("Layout")
                with Horizontal(classes="settings-pair"):
                    yield Select(
                        [(name, name) for name in SURFACES],
                        value=values["initial_surface"],
                        allow_blank=False,
                        prompt="Initial view",
                        id="setting-initial-surface",
                    )
                    yield Select(
                        BOOLEAN_OPTIONS,
                        value=values["sidebar_visible"],
                        allow_blank=False,
                        prompt="Sidebar",
                        id="setting-sidebar-visible",
                    )
                    yield Input(
                        value=values["sidebar_width"],
                        placeholder="Sidebar width",
                        id="setting-sidebar-width",
                    )
                    yield Input(
                        value=values["agenda_days"],
                        placeholder="Agenda days",
                        id="setting-agenda-days",
                    )
                with Horizontal(classes="settings-pair"):
                    yield Select(
                        BOOLEAN_OPTIONS,
                        value=values["task_show_due"],
                        allow_blank=False,
                        prompt="Show task due",
                        id="setting-task-due",
                    )
                    yield Select(
                        BOOLEAN_OPTIONS,
                        value=values["notes_show_preview"],
                        allow_blank=False,
                        prompt="Show note preview",
                        id="setting-notes-preview",
                    )
                    yield Select(
                        BOOLEAN_OPTIONS,
                        value=values["agenda_show_calendar"],
                        allow_blank=False,
                        prompt="Show event calendar",
                        id="setting-agenda-calendar",
                    )
                    yield Select(
                        BOOLEAN_OPTIONS,
                        value=values["agenda_show_location"],
                        allow_blank=False,
                        prompt="Show event location",
                        id="setting-agenda-location",
                    )
                yield Label("Profiles")
                yield Input(
                    value=values["active_profile"],
                    placeholder="Active profile name",
                    id="setting-active-profile",
                )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Save", variant="primary", id="settings-save")
                yield Button("Edit config.json", id="settings-edit-config")
                yield Button("Cancel", id="settings-cancel")

    def action_cancel(self) -> None:
        self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "settings-edit-config":
            self.dismiss(None)
            self.hcb.call_after_refresh(self.hcb.action_edit_config_file)
            return
        if event.button.id != "settings-save":
            self.dismiss(None)
            return
        self.dismiss(
            {
                "profile": self._selected_value("#setting-profile", "a profile"),
                "theme_preset": self._selected_value("#setting-theme", "a theme palette"),
                "density": self._selected_value("#setting-density", "a density"),
                "borders": self._selected_value("#setting-borders", "a border style"),
                "focus": self._selected_value("#setting-focus", "a focus style"),
                "mouse": self._selected_value("#setting-mouse", "a mouse setting"),
                "week_starts_on": self._selected_value("#setting-week", "a week start day"),
                "date_time_format": self._selected_value(
                    "#setting-date-time-format", "a date and time display"
                ),
                "editor": self.query_one("#setting-editor", Input).value.strip(),
                "external_editor": self.query_one("#setting-external-editor", Input).value.strip(),
                "loader": self._selected_loader(),
                "colors": self.query_one("#settings-colors", TextArea).text.strip(),
                "roles": self.query_one("#settings-roles", TextArea).text.strip(),
                "stylesheet": self.query_one("#setting-stylesheet", Input).value.strip(),
                "time_zone": self.query_one("#setting-time-zone", Input).value.strip(),
                "reminders_enabled": self._selected_value(
                    "#setting-reminders", "a reminders setting"
                ),
                "reminder_poll_seconds": self.query_one(
                    "#setting-reminder-poll", Input
                ).value.strip(),
                "reminder_catch_up_minutes": self.query_one(
                    "#setting-reminder-catch-up", Input
                ).value.strip(),
                "reminder_jitter_seconds": self.query_one(
                    "#setting-reminder-jitter", Input
                ).value.strip(),
                "reminder_sync_interval_minutes": self.query_one(
                    "#setting-reminder-sync-interval", Input
                ).value.strip(),
                "reminder_sync_mode": self._selected_value(
                    "#setting-reminder-sync-mode", "a reminder sync mode"
                ),
                "default_account_id": self.query_one(
                    "#setting-default-account", Input
                ).value.strip(),
                "default_task_list_id": self.query_one(
                    "#setting-default-list", Input
                ).value.strip(),
                "default_calendar_id": self.query_one(
                    "#setting-default-calendar", Input
                ).value.strip(),
                "capture_duration": self.query_one(
                    "#setting-capture-duration", Input
                ).value.strip(),
                "capture_remove": self._selected_value(
                    "#setting-capture-remove", "a capture setting"
                ),
                "capture_task_aliases": self.query_one(
                    "#setting-capture-task-aliases", Input
                ).value,
                "capture_event_aliases": self.query_one(
                    "#setting-capture-event-aliases", Input
                ).value,
                "capture_high_aliases": self.query_one(
                    "#setting-capture-high-aliases", Input
                ).value,
                "capture_medium_aliases": self.query_one(
                    "#setting-capture-medium-aliases", Input
                ).value,
                "capture_low_aliases": self.query_one("#setting-capture-low-aliases", Input).value,
                "keys": self.query_one("#settings-keys", TextArea).text.strip(),
                "initial_surface": self._selected_value(
                    "#setting-initial-surface", "an initial view"
                ),
                "sidebar_visible": self._selected_value(
                    "#setting-sidebar-visible", "a sidebar setting"
                ),
                "sidebar_width": self.query_one("#setting-sidebar-width", Input).value.strip(),
                "agenda_days": self.query_one("#setting-agenda-days", Input).value.strip(),
                "task_show_due": self._selected_value(
                    "#setting-task-due", "a task display setting"
                ),
                "notes_show_preview": self._selected_value(
                    "#setting-notes-preview", "a notes display setting"
                ),
                "agenda_show_calendar": self._selected_value(
                    "#setting-agenda-calendar", "an agenda display setting"
                ),
                "agenda_show_location": self._selected_value(
                    "#setting-agenda-location", "an agenda display setting"
                ),
                "active_profile": self.query_one("#setting-active-profile", Input).value.strip(),
            }
        )

    def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id != "setting-theme" or not isinstance(event.value, str):
            return
        if event.value == CURRENT_THEME_VALUE:
            return
        selected = preset(event.value)
        self.query_one("#setting-profile", Select).value = selected.profile
        self.query_one("#settings-colors", TextArea).load_text(
            json.dumps(asdict(selected.colors), indent=2, sort_keys=True)
        )

    def _theme_options(self) -> tuple[tuple[str, str], ...]:
        return self.hcb.settings_theme_options()

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
                    f"{self.hcb.format_time(slot.start)}–{self.hcb.format_time(slot.end)}",
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

    def __init__(self, app_service: HcbApp, *, initial_query: str = "") -> None:
        super().__init__()
        self.hcb = app_service
        self.initial_query = initial_query

    def compose(self) -> ComposeResult:
        with Vertical(id="palette-dialog"):
            yield Input(
                value=self.initial_query,
                placeholder="Type a command or search local data",
                id="palette-query",
            )
            yield ListView(id="palette-results")

    def on_mount(self) -> None:
        self.query_one(Input).focus()
        self._fill(self.initial_query)

    def _fill(self, query: str) -> None:
        view = self.query_one(ListView)
        view.clear()
        needle = query.casefold().strip()
        for title, action in PALETTE_COMMANDS:
            if not needle or needle in title.casefold():
                view.append(EntityRow(title, kind="command", item_id=action, action=action))
        if needle and self.hcb.account_id:
            for result in self.hcb.search_local(query):
                view.append(
                    EntityRow(
                        f"{result.display_title}  · {result.kind.replace('-', ' ')}",
                        kind=result.kind,
                        item_id=str(result.item.id),
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
