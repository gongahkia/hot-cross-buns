"""User commands, editors, batch flows, settings, and remote workflows."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal, cast

from textual import work

from .application import (
    BatchActionPreview,
    BatchMovePreview,
    ResponseStatus,
    TimeSlot,
)
from .config import KeyBindings, RoleStyle, ThemeColors, ThemeRoles, TuiSettings
from .models import CapturePreferences
from .errors import HcbError
from .loaders import LOADER_PRESETS
from .models import DateTimeKind, Event, EventDateTime, Task, TaskStatus
from .storage import Storage
from .themes import preset, presets
from .tui import (
    CURRENT_THEME_VALUE,
    SURFACES,
)
from .tui_components import (
    BatchActionScreen,
    BatchMoveScreen,
    BulkScreen,
    CalendarScreen,
    ConfirmScreen,
    ConflictScreen,
    EditorScreen,
    EventEditorScreen,
    FindTimeScreen,
    ImportScreen,
    ItemViewScreen,
    PaletteScreen,
    RsvpScreen,
    ScheduleScreen,
    SettingsScreen,
)

if TYPE_CHECKING:
    pass


class ActionMixin:
    resource_filter: tuple[str, str] | None
    selected: tuple[str, str] | None
    surface: str

    def action_surface(self: Any, name: str) -> None:
        if name not in SURFACES:
            return
        self.surface = name
        self.selected = None
        self._render_chrome(refresh_resources=False)
        self._render_surface()

    def action_palette(self: Any) -> None:
        self.push_screen(PaletteScreen(self), self._palette_result)

    def action_help(self: Any) -> None:
        bindings = self.runtime.config.keys
        self.notify(
            " · ".join(
                (
                    f"Help {bindings.help}",
                    f"Command {bindings.search}",
                    f"New {bindings.create}",
                    f"Edit {bindings.edit}",
                    f"Sync {bindings.sync}",
                )
            ),
            timeout=12,
        )

    def _palette_result(self: Any, result: tuple[str, str] | None) -> None:
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
            self.push_screen(self._onboarding_screen(), self._onboarding_result)
        elif kind in {"task", "event"}:
            self.surface = "Tasks" if kind == "task" else "Agenda"
            self.resource_filter = None
            self.selected = (kind, value)
            self._render_chrome(refresh_resources=False)
            self._render_surface()
        elif kind == "task-list":
            self.surface = "Tasks"
            self.resource_filter = ("task-list", value)
            self.selected = None
            self._render_chrome(refresh_resources=False)
            self._render_surface()
        elif kind == "calendar":
            self.surface = "Agenda"
            self.resource_filter = ("calendar", value)
            self.selected = None
            self._render_chrome(refresh_resources=False)
            self._render_surface()
        elif kind == "drive":
            self.selected = (kind, value)
            self.action_view()
        elif kind == "saved-search" and self.account_id is not None:
            saved = next(
                (
                    item
                    for item in self.runtime.application.list_saved_searches(self.account_id)
                    if item.id == value
                ),
                None,
            )
            if saved is not None:
                self.push_screen(
                    PaletteScreen(self, initial_query=saved.query), self._palette_result
                )
        elif kind == "conflict":
            self.push_screen(ConflictScreen(self))

    def action_create(self: Any) -> None:
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

    def _create_result(self: Any, result: dict[str, str] | None) -> None:
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

    def action_edit(self: Any) -> None:
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
                deletable=True,
            ),
            self._edit_result,
        )

    def action_view(self: Any) -> None:
        """Open the selected item in a read-only view before editing or deleting it."""
        item = self._selected_task() or self._selected_event() or self._selected_drive()
        if item is None:
            self.notify("Select a task, note, or event to view", severity="warning")
            return
        self.push_screen(ItemViewScreen(self, item), self._view_result)

    def _view_result(self: Any, result: str | None) -> None:
        if result == "edit":
            self.action_edit()
        elif result == "delete":
            self.action_delete()

    def _edit_result(self: Any, result: dict[str, str] | None) -> None:
        task = self._selected_task()
        if not result or task is None or self.account_id is None:
            return
        if result.get("action") == "delete":
            self._confirm_editor_delete("task", task.id)
            return
        if not result["title"]:
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

    def _event_create_result(self: Any, result: dict[str, str] | None) -> None:
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

    def _event_edit_result(self: Any, result: dict[str, str] | None) -> None:
        event = self._selected_event()
        if not result or event is None or self.account_id is None:
            return
        if result.get("action") == "delete":
            self._confirm_editor_delete("event", event.id)
            return
        if not result["title"]:
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

    def _confirm_editor_delete(self: Any, kind: Literal["task", "event"], item_id: str) -> None:
        self.push_screen(
            ConfirmScreen(
                f"Delete this {kind}?",
                confirm_label="Delete",
                confirm_variant="error",
            ),
            lambda confirmed: self._delete_editor_item(kind, item_id, confirmed),
        )

    def _delete_editor_item(
        self: Any, kind: Literal["task", "event"], item_id: str, confirmed: bool | None
    ) -> None:
        if not confirmed or self.account_id is None:
            return
        if kind == "task":
            self.runtime.application.delete_tasks(self.account_id, [item_id])
            self.marked.discard(item_id)
        else:
            self.runtime.application.delete_events(self.account_id, [item_id])
            self.marked_events.discard(item_id)
        if self.selected == (kind, item_id):
            self.selected = None
        self.refresh_workspace()
        self.notify(f"{kind.title()} deleted")

    def _batch_ids(
        self: Any, entity_type: Literal["task", "event"], *, include_selected: bool = True
    ) -> list[str]:
        if entity_type == "task":
            ids = [item.id for item in self.cache.tasks if item.id in self.marked]
        else:
            ids = [item.id for item in self.cache.events if item.id in self.marked_events]
        if ids or not include_selected:
            return ids
        if self.selected and self.selected[0] == entity_type:
            return [self.selected[1]]
        return []

    def batch_move_preview_text(self: Any, preview: BatchMovePreview) -> str:
        if preview.entity_type == "task":
            titles = dict(self.cache.task_lists)
            destination = titles.get(preview.destination_id, preview.destination_id)
            lines = [
                f"Move {len(preview.items)} task(s) to {destination!r} as top-level tasks:",
                "",
            ]
            for task in preview.items:
                assert isinstance(task, Task)
                source = titles.get(task.list_id, task.list_id)
                lines.append(f"{task.title}  ·  {source} → {destination}")
            return "\n".join(lines)
        titles = {item_id: title for item_id, title, _selected in self.cache.calendars}
        destination = titles.get(preview.destination_id, preview.destination_id)
        lines = [f"Move {len(preview.items)} event(s) to {destination!r}:", ""]
        for event in preview.items:
            assert isinstance(event, Event)
            source = titles.get(event.calendar_id, event.calendar_id)
            lines.append(f"{event.summary}  ·  {source} → {destination}")
        return "\n".join(lines)

    @staticmethod
    def batch_action_preview_text(preview: BatchActionPreview) -> str:
        if preview.entity_type == "task":
            tasks = tuple(item for item in preview.items if isinstance(item, Task))
            if preview.action == "delete":
                lines = [f"Delete {len(tasks)} task(s):", ""]
                lines.extend(f"{task.title}  ·  active → deleted" for task in tasks)
            else:
                target = "completed" if preview.action == "complete" else "needs action"
                lines = [f"{preview.action.title()} {len(tasks)} task(s):", ""]
                lines.extend(f"{task.title}  ·  {task.status.value} → {target}" for task in tasks)
            return "\n".join(lines)

        events = tuple(item for item in preview.items if isinstance(item, Event))
        if preview.action == "delete":
            lines = [f"Delete {len(events)} event(s):", ""]
            lines.extend(f"{event.summary}  ·  active → deleted" for event in events)
        else:
            target = preview.response_status or "needsAction"
            lines = [f"Queue RSVP {target} for {len(events)} event(s):", ""]
            lines.extend(
                f"{event.summary}  ·  {event.attendee_response or 'needsAction'} → {target}"
                for event in events
            )
        return "\n".join(lines)

    def apply_batch_action(self: Any, preview: BatchActionPreview) -> bool:
        """Apply one previously displayed plan, retaining it on a local failure."""
        if self.account_id is None:
            return False
        item_ids = [item.id for item in preview.items]
        try:
            if preview.entity_type == "task":
                if preview.action in {"complete", "reopen"}:
                    self.runtime.application.complete_tasks(
                        self.account_id,
                        item_ids,
                        completed=preview.action == "complete",
                    )
                elif preview.action == "delete":
                    self.runtime.application.delete_tasks(self.account_id, item_ids)
                    self.marked.difference_update(item_ids)
                else:
                    raise ValueError("unsupported task batch action")
            elif preview.action == "respond":
                response = preview.response_status
                if response is None:
                    raise ValueError("batch RSVP has no response")
                self.runtime.application.respond_events(self.account_id, item_ids, response)
            elif preview.action == "delete":
                self.runtime.application.delete_events(self.account_id, item_ids)
                self.marked_events.difference_update(item_ids)
            else:
                raise ValueError("unsupported event batch action")
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return False
        self.refresh_workspace()
        action = "RSVP" if preview.action == "respond" else preview.action
        self.notify(f"Queued {action} for {len(item_ids)} {preview.entity_type}(s)")
        return True

    def _review_batch_action(self: Any, preview: BatchActionPreview) -> None:
        self.push_screen(BatchActionScreen(self, preview))

    def action_move_marked(self: Any, entity_type: Literal["task", "event"]) -> None:
        ids = self._batch_ids(entity_type)
        destinations = self.cache.task_lists if entity_type == "task" else self.cache.calendars
        if not ids:
            self.notify(f"Select {entity_type}s to move", severity="warning")
            return
        if not destinations:
            label = "task list" if entity_type == "task" else "calendar"
            self.notify(f"Create a destination {label} first", severity="warning")
            return
        self.push_screen(BatchMoveScreen(self, entity_type, tuple(ids)))

    def action_rsvp(self: Any) -> None:
        event_ids = self._batch_ids("event")
        if not event_ids:
            self.notify("Select an event to RSVP", severity="warning")
            return
        self.push_screen(RsvpScreen(), self._rsvp_result)

    def _rsvp_result(self: Any, response: str | None) -> None:
        if response is None or self.account_id is None:
            return
        event_ids = self._batch_ids("event")
        if not event_ids:
            return
        try:
            preview = self.runtime.application.preview_event_response(
                self.account_id, event_ids, cast(ResponseStatus, response)
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._review_batch_action(preview)

    def action_complete(self: Any) -> None:
        if self.account_id is None:
            return
        ids = self._batch_ids("task")
        if not ids:
            self.notify("Select a task to complete", severity="warning")
            return
        targets = [item for item in self.cache.tasks if item.id in set(ids)]
        completed = not all(item.status is TaskStatus.COMPLETED for item in targets)
        try:
            preview = self.runtime.application.preview_task_completion(
                self.account_id, [item.id for item in targets], completed=completed
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._review_batch_action(preview)

    def action_mark(self: Any) -> None:
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

    def action_delete(self: Any) -> None:
        ids = self._batch_ids("task")
        event_ids = self._batch_ids("event")
        if not ids and not event_ids:
            self.notify("Select an item to delete", severity="warning")
            return
        if ids and event_ids:
            self.notify(
                "Delete marked tasks or marked events separately so the batch stays unambiguous",
                severity="warning",
            )
            return
        if self.account_id is None:
            return
        try:
            preview = (
                self.runtime.application.preview_task_deletion(self.account_id, ids)
                if ids
                else self.runtime.application.preview_event_deletion(self.account_id, event_ids)
            )
        except (ValueError, HcbError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._review_batch_action(preview)

    def action_undo(self: Any) -> None:
        if self.account_id is not None:
            changed = self.runtime.application.undo(self.account_id)
            self.refresh_workspace()
            self.notify("Nothing to undo" if changed is None else "Undone")

    def action_redo(self: Any) -> None:
        if self.account_id is not None:
            changed = self.runtime.application.redo(self.account_id)
            self.refresh_workspace()
            self.notify("Nothing to redo" if changed is None else "Redone")

    def calendar_rows(self: Any) -> tuple[tuple[str, str, bool], ...]:
        return cast(tuple[tuple[str, str, bool], ...], self.cache.calendars)

    def create_calendar(self: Any, name: str) -> bool:
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

    def toggle_calendar(self: Any, calendar_id: str) -> None:
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

    def confirm_calendar_delete(self: Any, calendar_id: str, callback: Callable[[], None]) -> None:
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

    def settings_values(self: Any) -> dict[str, str]:
        config = self.runtime.config
        preset_names = {item.name for item in presets()}
        return {
            "theme_preset": (
                config.theme.preset if config.theme.preset in preset_names else CURRENT_THEME_VALUE
            ),
            "profile": config.theme.profile,
            "density": config.theme.density,
            "borders": config.theme.borders,
            "focus": config.theme.focus,
            "mouse": str(config.theme.mouse).lower(),
            "loader": config.theme.loader,
            "week_starts_on": str(config.preferences.week_starts_on),
            "date_time_format": config.preferences.date_time_format,
            "editor": config.preferences.editor,
            "external_editor": config.keys.external_editor,
            "colors": json.dumps(asdict(config.theme.colors), indent=2, sort_keys=True),
            "roles": json.dumps(asdict(config.theme.roles), indent=2, sort_keys=True),
            "stylesheet": config.theme.stylesheet or "",
            "time_zone": config.preferences.time_zone,
            "default_account_id": config.preferences.default_account_id or "",
            "default_task_list_id": config.preferences.default_task_list_id or "",
            "default_calendar_id": config.preferences.default_calendar_id or "",
            "reminders_enabled": str(config.preferences.reminders_enabled).lower(),
            "reminder_poll_seconds": str(config.preferences.reminder_poll_seconds),
            "capture_duration": str(config.preferences.capture.default_event_duration_minutes),
            "capture_remove": str(config.preferences.capture.remove_recognized_text).lower(),
            "capture_task_aliases": ", ".join(config.preferences.capture.task_aliases),
            "capture_event_aliases": ", ".join(config.preferences.capture.event_aliases),
            "capture_high_aliases": ", ".join(config.preferences.capture.high_priority_aliases),
            "capture_medium_aliases": ", ".join(config.preferences.capture.medium_priority_aliases),
            "capture_low_aliases": ", ".join(config.preferences.capture.low_priority_aliases),
            "keys": json.dumps(asdict(config.keys), indent=2, sort_keys=True),
            "initial_surface": config.tui.initial_surface,
            "sidebar_visible": str(config.tui.sidebar_visible).lower(),
            "sidebar_width": str(config.tui.sidebar_width),
            "agenda_days": str(config.tui.agenda_days),
            "task_show_due": str(config.tui.task_show_due).lower(),
            "notes_show_preview": str(config.tui.notes_show_preview).lower(),
            "agenda_show_calendar": str(config.tui.agenda_show_calendar).lower(),
            "agenda_show_location": str(config.tui.agenda_show_location).lower(),
            "active_profile": config.active_profile or "",
        }

    def settings_theme_options(self: Any) -> tuple[tuple[str, str], ...]:
        """Return theme choices with the matching local palette clearly identified."""
        current = self.runtime.config.theme.preset
        available = presets()
        names = {item.name for item in available}
        detected = self._local_environment().suggested_preset
        options: list[tuple[str, str]] = []
        if current in names and current == detected:
            options.append((f"Use detected {current}", current))
        elif current in names:
            options.append((f"Current: {current}", current))
        else:
            options.append(("Keep current theme", CURRENT_THEME_VALUE))
        if detected and detected != current:
            options.append((f"Use detected {detected}", detected))
        options.extend(
            (item.name, item.name) for item in available if item.name not in {current, detected}
        )
        return tuple(options)

    def _settings_result(self: Any, result: dict[str, str] | None) -> None:
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
            date_time_format = result["date_time_format"]
            if date_time_format not in {"friendly", "friendly_24h", "iso"}:
                raise ValueError("choose a supported date and time display")
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
            roles_data = json.loads(result["roles"])
            if not isinstance(roles_data, dict):
                raise ValueError("semantic roles must be a JSON object")
            roles = ThemeRoles(
                **{
                    name: RoleStyle(**value)
                    for name, value in roles_data.items()
                    if isinstance(value, dict)
                }
            )
            if len(roles_data) != len(asdict(roles)):
                raise ValueError("semantic roles must define valid role objects")
            keys_data = json.loads(result["keys"])
            if not isinstance(keys_data, dict):
                raise ValueError("keymap must be a JSON object")
            capture = CapturePreferences(
                default_event_duration_minutes=int(result["capture_duration"]),
                remove_recognized_text=result["capture_remove"].casefold() == "true",
                task_aliases=self._aliases(result["capture_task_aliases"]),
                event_aliases=self._aliases(result["capture_event_aliases"]),
                high_priority_aliases=self._aliases(result["capture_high_aliases"]),
                medium_priority_aliases=self._aliases(result["capture_medium_aliases"]),
                low_priority_aliases=self._aliases(result["capture_low_aliases"]),
            )
            tui = TuiSettings(
                initial_surface=result["initial_surface"],
                sidebar_visible=result["sidebar_visible"].casefold() == "true",
                sidebar_width=int(result["sidebar_width"]),
                agenda_days=int(result["agenda_days"]),
                task_show_due=result["task_show_due"].casefold() == "true",
                notes_show_preview=result["notes_show_preview"].casefold() == "true",
                agenda_show_calendar=result["agenda_show_calendar"].casefold() == "true",
                agenda_show_location=result["agenda_show_location"].casefold() == "true",
            )
            theme_preset: str | None = result["theme_preset"]
            if theme_preset is None or theme_preset == CURRENT_THEME_VALUE:
                theme_preset = None
            else:
                selected = preset(theme_preset)
                if profile != selected.profile or colors != selected.colors:
                    theme_preset = None
            config = self.runtime.update_tui_settings(
                profile=profile,
                density=density,
                borders=borders,
                focus=focus,
                mouse=mouse_raw == "true",
                loader=loader,
                theme_preset=theme_preset,
                week_starts_on=int(result["week_starts_on"]),
                date_time_format=date_time_format,
                editor=result["editor"],
                external_editor=result["external_editor"],
                colors=colors,
                roles=roles,
                stylesheet=result["stylesheet"] or None,
                time_zone=result["time_zone"],
                default_account_id=result["default_account_id"] or None,
                default_task_list_id=result["default_task_list_id"] or None,
                default_calendar_id=result["default_calendar_id"] or None,
                reminders_enabled=result["reminders_enabled"].casefold() == "true",
                reminder_poll_seconds=int(result["reminder_poll_seconds"]),
                capture=capture,
                keys=KeyBindings(**keys_data),
                tui=tui,
                active_profile=result["active_profile"] or None,
            )
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            self.notify(str(exc), severity="error")
            return
        self._apply_visual_config(config)
        self._observed_config_marker = self._config_marker()
        self._render_chrome(refresh_resources=False)
        self._render_surface()
        self.notify("Settings saved and applied")

    @staticmethod
    def _aliases(value: str) -> tuple[str, ...]:
        return tuple(alias.strip() for alias in value.split(",") if alias.strip())

    def find_time_local(
        self: Any, raw_day: str, raw_duration: str, raw_start: str, raw_end: str
    ) -> tuple[TimeSlot, ...]:
        if self.account_id is None:
            return ()
        return cast(
            tuple[TimeSlot, ...],
            self.runtime.application.find_time(
                self.account_id,
                date.fromisoformat(raw_day),
                duration_minutes=int(raw_duration),
                day_start=int(raw_start),
                day_end=int(raw_end),
            ),
        )

    def _freebusy_request(
        self: Any, raw_day: str, raw_start: str, raw_end: str
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

    def remote_freebusy(self: Any, raw_day: str, raw_start: str, raw_end: str) -> dict[str, object]:
        """Run the explicit Google request synchronously for non-TUI callers."""
        account_id, body = self._freebusy_request(raw_day, raw_start, raw_end)
        return cast(dict[str, object], self.runtime.sync_engine(account_id).gateway.freebusy(body))

    def request_remote_freebusy(
        self: Any,
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
        self: Any,
        account_id: str,
        body: dict[str, object],
        callback: Callable[[dict[str, object]], None],
    ) -> None:
        failure: Exception | None = None
        try:
            self.call_from_thread(self.update_loading, "Waiting for Google availability")
            result = self.runtime.sync_engine(account_id).gateway.freebusy(body)
        except Exception as exc:  # Google failures must not tear down the workspace.
            failure = exc
        else:
            self.call_from_thread(callback, result)
        finally:
            self.call_from_thread(self.stop_loading)
        if failure is not None:
            self.call_from_thread(
                self._show_remote_failure, "Google free/busy", failure, account_id
            )

    def action_jump(self: Any) -> None:
        self.push_screen(
            EditorScreen(due=self.selected_date.isoformat(), jump=True),
            self._jump_result,
        )

    def _jump_result(self: Any, result: dict[str, str] | None) -> None:
        if not result:
            return
        try:
            selected_date = date.fromisoformat(result["date"])
        except ValueError:
            self.notify("Use a date in YYYY-MM-DD format", severity="error")
            return
        self._select_date(selected_date)

    @work(thread=True, exclusive=True, group="sync")
    def action_sync(self: Any) -> None:
        if self.account_id is None:
            self.call_from_thread(
                self.notify,
                "No account is configured. Open / → First-run setup, then connect Google.",
                severity="warning",
            )
            return
        if not self._sync_lock.acquire(blocking=False):
            self.call_from_thread(
                self.notify,
                "A sync is already running. Press Esc to cancel it.",
                severity="warning",
            )
            return
        account_id = self.account_id
        failure: Exception | None = None
        self._sync_cancel.clear()
        self.call_from_thread(lambda: self.start_loading("Preparing Google sync", cancellable=True))
        worker_storage: Storage | None = None
        try:
            engine = self.runtime.sync_engine(account_id)
            worker_storage = Storage(self.runtime.paths.database_file)
            engine.storage = worker_storage
            result = engine.sync(
                account_id,
                progress=lambda status: self.call_from_thread(self.update_loading, status),
                cancelled=self._sync_cancel.is_set,
                cancel_hint="Press Esc to cancel.",
            )
        except Exception as exc:  # provider failures must not tear down the workspace
            failure = exc
        else:
            if result.cancelled:
                self.call_from_thread(
                    self.notify,
                    result.retry_message or "Sync cancelled. Local changes remain queued.",
                    severity="warning",
                )
            elif result.retry_exhausted:
                self.call_from_thread(
                    self.notify,
                    result.retry_message or "Sync paused. Local changes remain queued.",
                    severity="warning",
                )
            elif result.conflicts:
                self.call_from_thread(
                    self.notify,
                    f"Sync completed with {result.conflicts} conflict(s). "
                    "Open Conflicts to review them; your marked items remain selected.",
                    severity="warning",
                )
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
            self._sync_lock.release()
        if failure is not None:
            self.call_from_thread(self._show_remote_failure, "Sync", failure, account_id)

    @work(thread=True, exclusive=True, group="sync")
    def action_refresh_instances(self: Any) -> None:
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
        account_id = self.account_id
        start = datetime.combine(self.selected_date, datetime.min.time(), UTC)
        duration = {"Day": 1, "Week": 7, "Month": 35}.get(self.surface, 14)
        self.call_from_thread(self.start_loading, "Preparing recurring instance refresh")
        worker_storage: Storage | None = None
        failure: Exception | None = None
        try:
            engine = self.runtime.sync_engine(account_id)
            worker_storage = Storage(self.runtime.paths.database_file)
            engine.storage = worker_storage
            self.call_from_thread(self.update_loading, "Fetching recurring events")
            events = engine.refresh_occurrences(
                account_id, calendar_id, start, start + timedelta(days=duration)
            )
        except Exception as exc:
            failure = exc
        else:
            self.call_from_thread(self.notify, f"Refreshed {len(events)} recurring instances")
        finally:
            if worker_storage is not None:
                worker_storage.close()
            self.call_from_thread(self.stop_loading)
            self.call_from_thread(self.refresh_workspace)
        if failure is not None:
            self.call_from_thread(
                self._show_remote_failure, "Instance refresh", failure, account_id
            )
