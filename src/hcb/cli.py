"""Scriptable command-line interface for HCB."""

from __future__ import annotations

import json
import os
import plistlib
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import typer
from typer import _click as click

from .application import SearchResult
from .config import ConfigError, load, save
from .errors import ExitCode, HcbError
from .import_export import (
    ImportedEvent,
    ImportedRecord,
    ImportedTask,
    export_csv,
    export_ics,
    export_json,
)
from .models import (
    Account,
    ConflictStatus,
    DateTimeKind,
    Event,
    EventDateTime,
    Task,
)
from .notifications import default_notifier
from .output import to_primitive
from .runtime import Runtime
from .scheduler import DaemonState, ReminderScheduler, run_loop


class HcbGroup(typer.core.TyperGroup):
    """Translate expected domain failures into stable, traceback-free exits."""

    def invoke(self, ctx: click.Context) -> Any:
        try:
            return super().invoke(ctx)
        except HcbError as exc:
            click.echo(f"Error: {exc.message}", err=True)
            if exc.hint:
                click.echo(f"Hint: {exc.hint}", err=True)
            raise click.exceptions.Exit(int(exc.exit_code)) from None
        except (ConfigError, ValueError) as exc:
            click.echo(f"Error: {exc}", err=True)
            raise click.exceptions.Exit(int(ExitCode.USAGE)) from None


CONTEXT = {"help_option_names": ["-h", "--help"]}
app = typer.Typer(
    cls=HcbGroup,
    context_settings=CONTEXT,
    no_args_is_help=True,
    help="Local-first Google Tasks and Calendar client.",
)
tasks_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Manage tasks.")
lists_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Manage task lists.")
notes_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Manage task notes.")
events_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Manage events.")
calendars_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Manage calendars.")
saved_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Manage saved searches.")
conflicts_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Resolve sync conflicts.")
import_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Preview or apply imports.")
auth_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Manage authentication.")
config_app = typer.Typer(cls=HcbGroup, context_settings=CONTEXT, help="Manage configuration.")
daemon_app = typer.Typer(
    cls=HcbGroup, context_settings=CONTEXT, help="Inspect sync daemon support."
)

app.add_typer(tasks_app, name="tasks")
app.add_typer(lists_app, name="task-lists")
app.add_typer(notes_app, name="notes")
app.add_typer(events_app, name="events")
app.add_typer(calendars_app, name="calendars")
app.add_typer(saved_app, name="saved-searches")
app.add_typer(conflicts_app, name="conflicts")
app.add_typer(import_app, name="import")
app.add_typer(auth_app, name="auth")
app.add_typer(config_app, name="config")
app.add_typer(daemon_app, name="daemon")


@dataclass(slots=True)
class State:
    runtime: Runtime
    account: str | None
    json: bool
    tsv: bool


_runtime_factory: Callable[[], Runtime] = Runtime


@app.callback()
def root(
    ctx: typer.Context,
    account: str | None = typer.Option(
        None, "--account", "-a", envvar="HCB_ACCOUNT", help="Account id."
    ),
    json_output: bool = typer.Option(False, "--json", help="Emit JSON."),
    tsv: bool = typer.Option(False, "--tsv", help="Emit tab-separated records."),
    no_color: bool = typer.Option(False, "--no-color", help="Disable terminal color."),
) -> None:
    if json_output and tsv:
        raise typer.BadParameter("--json and --tsv are mutually exclusive")
    if no_color or os.environ.get("NO_COLOR") is not None or os.environ.get("TERM") == "dumb":
        ctx.color = False
    ctx.obj = State(_runtime_factory(), account, json_output, tsv)
    ctx.call_on_close(ctx.obj.runtime.close)


def _state(ctx: typer.Context) -> State:
    return cast(State, ctx.find_root().obj)


def _account(ctx: typer.Context) -> str:
    state = _state(ctx)
    return state.runtime.account_id(state.account)


def _rows(value: Any) -> list[dict[str, Any]]:
    primitive = to_primitive(value)
    if isinstance(primitive, list):
        return [item if isinstance(item, dict) else {"value": item} for item in primitive]
    return [primitive if isinstance(primitive, dict) else {"value": primitive}]


def _emit(
    ctx: typer.Context,
    value: Any,
    *,
    fields: Sequence[str] = (),
    human: Callable[[Any], str] | None = None,
) -> None:
    state = _state(ctx)
    primitive = to_primitive(value)
    if state.json:
        typer.echo(json.dumps(primitive, ensure_ascii=False, indent=2, sort_keys=True))
        return
    if state.tsv:
        rows = _rows(value)
        selected = list(fields) or (list(rows[0]) if rows else [])
        typer.echo("\t".join(selected))
        for row in rows:
            typer.echo(
                "\t".join(
                    str(to_primitive(row.get(field)) if row.get(field) is not None else "")
                    .replace("\t", " ")
                    .replace("\n", " ")
                    for field in selected
                )
            )
        return
    values = value if isinstance(value, (list, tuple)) else (value,)
    for item in values:
        if human:
            typer.echo(human(item))
        elif isinstance(item, str):
            typer.echo(item)
        else:
            row = to_primitive(item)
            typer.echo("  ".join(f"{key}={val}" for key, val in row.items() if val is not None))


def _confirm(yes: bool, message: str) -> None:
    if yes:
        return
    if not sys.stdin.isatty():
        raise ValueError("destructive operation requires --yes when stdin is not a TTY")
    if not typer.confirm(message):
        raise typer.Abort()


def _event_point(raw: str, all_day: bool, zone: str | None) -> EventDateTime:
    if all_day:
        return EventDateTime(DateTimeKind.DATE, date.fromisoformat(raw))
    value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    return EventDateTime(DateTimeKind.DATETIME, value, zone)


def _task_record(task: Task, lists: dict[str, str]) -> ImportedTask:
    return ImportedTask(
        title=task.title,
        list=lists.get(task.list_id, task.list_id),
        due=task.due.isoformat() if task.due else None,
        notes=task.notes,
        priority=task.priority.value,
    )


def _event_record(event: Event, calendars: dict[str, str]) -> ImportedEvent:
    return ImportedEvent(
        title=event.summary,
        calendar=calendars.get(event.calendar_id, event.calendar_id),
        start=event.start.value.isoformat(),
        end=event.end.value.isoformat(),
        all_day=event.start.kind is DateTimeKind.DATE,
        time_zone=event.start.time_zone,
        description=event.description,
        location=event.location,
        recurrence=event.recurrence,
    )


# Tasks
@tasks_app.command("list")
def tasks_list(
    ctx: typer.Context,
    task_list: str | None = typer.Option(None, "--list"),
    completed: bool = typer.Option(False, "--completed"),
) -> None:
    items = _state(ctx).runtime.storage.list_tasks(_account(ctx), task_list)
    if not completed:
        items = [item for item in items if item.status.value != "completed"]
    _emit(
        ctx,
        items,
        fields=("id", "list_id", "title", "status", "due", "priority"),
        human=lambda item: f"{item.id}\t{item.title}",
    )


@tasks_app.command("create")
def tasks_create(
    ctx: typer.Context,
    title: str,
    task_list: str = typer.Option(..., "--list"),
    notes: str | None = typer.Option(None),
    due: str | None = typer.Option(None),
    priority: str = typer.Option("none"),
) -> None:
    item = _state(ctx).runtime.application.create_task(
        _account(ctx),
        task_list,
        title,
        notes=notes,
        due=date.fromisoformat(due) if due else None,
        priority=priority,
    )
    _emit(ctx, item, human=lambda value: f"Created task {value.id}: {value.title}")


@tasks_app.command("edit")
def tasks_edit(
    ctx: typer.Context,
    task_id: str,
    title: str | None = typer.Option(None),
    notes: str | None = typer.Option(None),
    due: str | None = typer.Option(None),
    clear_due: bool = typer.Option(False, "--clear-due"),
    priority: str | None = typer.Option(None),
) -> None:
    account = _account(ctx)
    state = _state(ctx)
    current = state.runtime.storage.get_task(account, task_id)
    if current is None:
        from .errors import NotFoundError

        raise NotFoundError(f"Task {task_id!r} does not exist")
    item = state.runtime.application.update_task(
        account,
        task_id,
        title=title,
        notes=current.notes if notes is None else notes,
        due=date.fromisoformat(due) if due else None,
        clear_due=clear_due,
        priority=priority,
    )
    _emit(ctx, item, human=lambda value: f"Updated task {value.id}: {value.title}")


@tasks_app.command("complete")
def tasks_complete(
    ctx: typer.Context,
    task_id: str,
    reopen: bool = typer.Option(False, "--reopen"),
) -> None:
    item = _state(ctx).runtime.application.complete_task(
        _account(ctx), task_id, completed=not reopen
    )
    _emit(ctx, item, human=lambda value: f"{value.id}\t{value.status.value}")


@tasks_app.command("delete")
def tasks_delete(
    ctx: typer.Context, task_id: str, yes: bool = typer.Option(False, "--yes", "-y")
) -> None:
    _confirm(yes, f"Delete task {task_id}?")
    item = _state(ctx).runtime.application.delete_task(_account(ctx), task_id)
    _emit(ctx, item, human=lambda value: f"Deleted task {value.id}")


@tasks_app.command("move")
def tasks_move(
    ctx: typer.Context,
    task_id: str,
    task_list: str | None = typer.Option(None, "--list"),
    parent: str | None = typer.Option(None),
    previous: str | None = typer.Option(None),
) -> None:
    item = _state(ctx).runtime.application.move_task(
        _account(ctx), task_id, list_id=task_list, parent_id=parent, previous_id=previous
    )
    _emit(ctx, item, human=lambda value: f"Moved task {value.id} to {value.list_id}")


# Task lists
@lists_app.command("list")
def lists_list(ctx: typer.Context) -> None:
    items = _state(ctx).runtime.storage.list_task_lists(_account(ctx))
    _emit(
        ctx,
        items,
        fields=("id", "title", "position"),
        human=lambda item: f"{item.id}\t{item.title}",
    )


@lists_app.command("create")
def lists_create(ctx: typer.Context, title: str) -> None:
    item = _state(ctx).runtime.application.create_task_list(_account(ctx), title)
    _emit(ctx, item, human=lambda value: f"Created task list {value.id}: {value.title}")


@lists_app.command("edit")
def lists_edit(ctx: typer.Context, list_id: str, title: str = typer.Option(...)) -> None:
    item = _state(ctx).runtime.application.update_task_list(_account(ctx), list_id, title=title)
    _emit(ctx, item, human=lambda value: f"Updated task list {value.id}: {value.title}")


@lists_app.command("delete")
def lists_delete(
    ctx: typer.Context, list_id: str, yes: bool = typer.Option(False, "--yes", "-y")
) -> None:
    _confirm(yes, f"Delete task list {list_id} and its tasks?")
    item = _state(ctx).runtime.application.delete_task_list(_account(ctx), list_id)
    _emit(ctx, item, human=lambda value: f"Deleted task list {value.id}")


# Notes are task-note conveniences.
@notes_app.command("show")
def notes_show(ctx: typer.Context, task_id: str) -> None:
    item = _state(ctx).runtime.storage.get_task(_account(ctx), task_id)
    if item is None:
        from .errors import NotFoundError

        raise NotFoundError(f"Task {task_id!r} does not exist")
    _emit(
        ctx,
        {"task_id": task_id, "notes": item.notes},
        fields=("task_id", "notes"),
        human=lambda value: value["notes"] or "",
    )


@notes_app.command("set")
def notes_set(ctx: typer.Context, task_id: str, text: str | None = typer.Argument(None)) -> None:
    value = sys.stdin.read() if text in (None, "-") else text
    item = _state(ctx).runtime.application.update_task(_account(ctx), task_id, notes=value)
    _emit(ctx, item, human=lambda task: f"Updated notes for {task.id}")


@notes_app.command("clear")
def notes_clear(
    ctx: typer.Context, task_id: str, yes: bool = typer.Option(False, "--yes", "-y")
) -> None:
    _confirm(yes, f"Clear notes for task {task_id}?")
    item = _state(ctx).runtime.application.update_task(_account(ctx), task_id, notes=None)
    _emit(ctx, item, human=lambda task: f"Cleared notes for {task.id}")


# Events
@events_app.command("agenda")
def events_agenda(
    ctx: typer.Context,
    start: str | None = typer.Option(None, "--from"),
    end: str | None = typer.Option(None, "--to"),
    calendar: str | None = typer.Option(None),
) -> None:
    start_date = date.fromisoformat(start) if start else date.today()
    stop = date.fromisoformat(end) if end else (start_date + timedelta(days=7))
    items = _state(ctx).runtime.storage.list_events(
        _account(ctx), calendar, start=start_date, end=stop
    )
    _emit(
        ctx,
        items,
        fields=("id", "calendar_id", "summary", "start", "end"),
        human=lambda item: f"{item.start.value.isoformat()}\t{item.id}\t{item.summary}",
    )


@events_app.command("create")
def events_create(
    ctx: typer.Context,
    summary: str,
    start: str = typer.Option(...),
    end: str = typer.Option(...),
    calendar: str = typer.Option(...),
    all_day: bool = typer.Option(False, "--all-day"),
    time_zone: str | None = typer.Option(None, "--time-zone"),
    description: str | None = typer.Option(None),
    location: str | None = typer.Option(None),
) -> None:
    item = _state(ctx).runtime.application.create_event(
        _account(ctx),
        calendar,
        summary,
        _event_point(start, all_day, time_zone),
        _event_point(end, all_day, time_zone),
        description=description,
        location=location,
    )
    _emit(ctx, item, human=lambda value: f"Created event {value.id}: {value.summary}")


@events_app.command("edit")
def events_edit(
    ctx: typer.Context,
    event_id: str,
    summary: str | None = typer.Option(None),
    start: str | None = typer.Option(None),
    end: str | None = typer.Option(None),
    all_day: bool = typer.Option(False, "--all-day"),
    time_zone: str | None = typer.Option(None, "--time-zone"),
    description: str | None = typer.Option(None),
    location: str | None = typer.Option(None),
) -> None:
    account = _account(ctx)
    state = _state(ctx)
    current = state.runtime.storage.get_event(account, event_id)
    if current is None:
        from .errors import NotFoundError

        raise NotFoundError(f"Event {event_id!r} does not exist")
    item = state.runtime.application.update_event(
        account,
        event_id,
        summary=summary,
        start=_event_point(start, all_day, time_zone) if start else None,
        end=_event_point(end, all_day, time_zone) if end else None,
        description=current.description if description is None else description,
        location=current.location if location is None else location,
    )
    _emit(ctx, item, human=lambda value: f"Updated event {value.id}: {value.summary}")


@events_app.command("delete")
def events_delete(
    ctx: typer.Context, event_id: str, yes: bool = typer.Option(False, "--yes", "-y")
) -> None:
    _confirm(yes, f"Delete event {event_id}?")
    item = _state(ctx).runtime.application.delete_event(_account(ctx), event_id)
    _emit(ctx, item, human=lambda value: f"Deleted event {value.id}")


@events_app.command("move")
def events_move(ctx: typer.Context, event_id: str, calendar: str = typer.Option(...)) -> None:
    item = _state(ctx).runtime.application.move_event(_account(ctx), event_id, calendar)
    _emit(ctx, item, human=lambda value: f"Moved event {value.id} to {value.calendar_id}")


@events_app.command("respond")
def events_respond(ctx: typer.Context, event_id: str, response: str) -> None:
    item = _state(ctx).runtime.application.respond_event(
        _account(ctx),
        event_id,
        response,  # type: ignore[arg-type]
    )
    _emit(ctx, item, human=lambda value: f"Queued {response} response for {value.entity_id}")


# Calendars
@calendars_app.command("list")
def calendars_list(ctx: typer.Context) -> None:
    items = _state(ctx).runtime.storage.list_calendars(_account(ctx))
    _emit(
        ctx,
        items,
        fields=("id", "summary", "time_zone", "selected"),
        human=lambda item: f"{item.id}\t{item.summary}",
    )


@calendars_app.command("create")
def calendars_create(
    ctx: typer.Context,
    summary: str,
    description: str | None = typer.Option(None),
    time_zone: str | None = typer.Option(None, "--time-zone"),
) -> None:
    item = _state(ctx).runtime.application.create_calendar(
        _account(ctx), summary, description=description, time_zone=time_zone
    )
    _emit(ctx, item, human=lambda value: f"Created calendar {value.id}: {value.summary}")


@calendars_app.command("subscribe")
def calendars_subscribe(ctx: typer.Context, calendar_id: str) -> None:
    item = _state(ctx).runtime.application.update_calendar(
        _account(ctx), calendar_id, selected=True
    )
    _emit(ctx, item, human=lambda value: f"Subscribed to calendar {value.id}")


@calendars_app.command("remove")
def calendars_remove(
    ctx: typer.Context, calendar_id: str, yes: bool = typer.Option(False, "--yes", "-y")
) -> None:
    _confirm(yes, f"Remove calendar {calendar_id} and its local events?")
    item = _state(ctx).runtime.application.delete_calendar(_account(ctx), calendar_id)
    _emit(ctx, item, human=lambda value: f"Removed calendar {value.id}")


# Search and capture
@app.command("search")
def search(ctx: typer.Context, query: str, limit: int = typer.Option(50)) -> None:
    results = _state(ctx).runtime.application.search(_account(ctx), query, limit=limit)
    rows = [
        {"kind": result.kind, "score": result.score, **to_primitive(result.item)}
        for result in results
    ]
    _emit(
        ctx,
        rows,
        fields=("kind", "id", "score", "title", "summary"),
        human=lambda row: f"{row['kind']}\t{row['id']}\t{row.get('title') or row.get('summary')}",
    )


@app.command("find-time")
def find_time(
    ctx: typer.Context,
    day: str = typer.Option(..., "--date"),
    duration: int = typer.Option(30, "--duration"),
    day_start: int = typer.Option(9, "--day-start"),
    day_end: int = typer.Option(17, "--day-end"),
) -> None:
    """Find free slots using only locally cached selected calendars."""
    slots = _state(ctx).runtime.application.find_time(
        _account(ctx),
        date.fromisoformat(day),
        duration_minutes=duration,
        day_start=day_start,
        day_end=day_end,
    )
    _emit(
        ctx,
        slots,
        fields=("start", "end"),
        human=lambda slot: f"{slot.start.isoformat()}\t{slot.end.isoformat()}",
    )


@saved_app.command("list")
def saved_list(ctx: typer.Context) -> None:
    items = _state(ctx).runtime.application.list_saved_searches(_account(ctx))
    _emit(
        ctx,
        items,
        fields=("id", "name", "query"),
        human=lambda item: f"{item.id}\t{item.name}\t{item.query}",
    )


@saved_app.command("save")
def saved_save(ctx: typer.Context, name: str, query: str) -> None:
    item = _state(ctx).runtime.application.save_search(_account(ctx), name, query)
    _emit(ctx, item, human=lambda value: f"Saved search {value.id}: {value.name}")


@saved_app.command("run")
def saved_run(ctx: typer.Context, search_id: str) -> None:
    results: tuple[SearchResult, ...] = _state(ctx).runtime.application.run_saved_search(
        _account(ctx), search_id
    )
    rows = [
        {"kind": result.kind, "score": result.score, **to_primitive(result.item)}
        for result in results
    ]
    _emit(ctx, rows, fields=("kind", "id", "score", "title", "summary"))


@saved_app.command("delete")
def saved_delete(
    ctx: typer.Context, search_id: str, yes: bool = typer.Option(False, "--yes", "-y")
) -> None:
    _confirm(yes, f"Delete saved search {search_id}?")
    _state(ctx).runtime.application.delete_saved_search(_account(ctx), search_id)
    _emit(
        ctx, {"deleted": search_id}, human=lambda value: f"Deleted saved search {value['deleted']}"
    )


@app.command("capture")
def capture(
    ctx: typer.Context,
    text: str | None = typer.Argument(None),
    kind: str = typer.Option("task"),
    task_list: str | None = typer.Option(None, "--list"),
    calendar: str | None = typer.Option(None),
    time_zone: str | None = typer.Option(None, "--time-zone"),
) -> None:
    raw = sys.stdin.read() if text in (None, "-") else text
    state = _state(ctx)
    item = state.runtime.application.quick_capture(
        _account(ctx),
        raw.strip(),
        kind,  # type: ignore[arg-type]
        task_list_id=task_list or state.runtime.config.preferences.default_task_list_id,
        calendar_id=calendar or state.runtime.config.preferences.default_calendar_id,
        time_zone=time_zone,
    )
    _emit(ctx, item, human=lambda value: f"Captured {value.id}")


# The only command boundary which constructs Google services.
@app.command("sync")
def sync(
    ctx: typer.Context,
    full_tasks: bool = typer.Option(False, "--full-tasks", help="Reset task cursors first."),
) -> None:
    state = _state(ctx)
    account = _account(ctx)
    if full_tasks:
        for item in state.runtime.storage.list_task_lists(account):
            if item.remote_id:
                state.runtime.storage.delete_cursor(account, f"tasks:{item.remote_id}")
    result = state.runtime.sync_engine(account).sync(account)
    _emit(
        ctx,
        result,
        human=lambda value: (
            f"Sync complete: pulled={value.pulled} pushed={value.pushed} "
            f"conflicts={value.conflicts}"
        ),
    )


# Conflicts
@conflicts_app.command("list")
def conflicts_list(ctx: typer.Context, all_items: bool = typer.Option(False, "--all")) -> None:
    items = _state(ctx).runtime.storage.list_conflicts(_account(ctx), open_only=not all_items)
    _emit(
        ctx,
        items,
        fields=("id", "entity_type", "entity_id", "status"),
        human=lambda item: (
            f"{item.id}\t{item.entity_type.value}\t{item.entity_id}\t{item.status.value}"
        ),
    )


@conflicts_app.command("resolve")
def conflicts_resolve(
    ctx: typer.Context,
    conflict_id: int,
    resolution: str = typer.Option(...),
    merged_json: str | None = typer.Option(None, "--merged-json"),
    yes: bool = typer.Option(False, "--yes", "-y"),
) -> None:
    _confirm(yes, f"Resolve conflict {conflict_id} as {resolution}?")
    merged = json.loads(merged_json) if merged_json else None
    item = _state(ctx).runtime.application.resolve_conflict(
        _account(ctx), conflict_id, ConflictStatus(resolution), merged_payload=merged
    )
    _emit(ctx, item, human=lambda value: f"Resolved conflict {value.id}: {value.status.value}")


# Import/export
def _source(path: str, filename: str | None) -> tuple[str, bytes]:
    if path == "-":
        if not filename:
            raise ValueError("--filename is required when importing from stdin")
        return filename, sys.stdin.buffer.read()
    target = Path(path)
    return target.name, target.read_bytes()


@import_app.command("preview")
def import_preview(
    ctx: typer.Context, path: str, filename: str | None = typer.Option(None)
) -> None:
    name, raw = _source(path, filename)
    preview = _state(ctx).runtime.application.preview_import(name, raw)
    _emit(
        ctx,
        preview,
        human=lambda value: (
            f"Import preview: rows={len(value.rows)} "
            f"errors={len(value.errors) + sum(bool(row.errors) for row in value.rows)}"
        ),
    )


@import_app.command("apply")
def import_apply(
    ctx: typer.Context,
    path: str,
    filename: str | None = typer.Option(None),
    task_list: str | None = typer.Option(None, "--list"),
    calendar: str | None = typer.Option(None),
    yes: bool = typer.Option(False, "--yes", "-y"),
) -> None:
    _confirm(yes, "Apply import to the local database?")
    name, raw = _source(path, filename)
    state = _state(ctx)
    preview = state.runtime.application.preview_import(name, raw)
    result = state.runtime.application.apply_import(
        _account(ctx),
        preview,
        default_task_list_id=task_list or state.runtime.config.preferences.default_task_list_id,
        default_calendar_id=calendar or state.runtime.config.preferences.default_calendar_id,
    )
    _emit(
        ctx,
        result,
        human=lambda value: f"Imported {len(value.tasks)} tasks and {len(value.events)} events",
    )


@app.command("export")
def export(
    ctx: typer.Context,
    format: str = typer.Option("json", "--format", "-f"),
    output: Path | None = typer.Option(None, "--output", "-o"),  # noqa: B008
) -> None:
    state = _state(ctx)
    account = _account(ctx)
    lists = {item.id: item.title for item in state.runtime.storage.list_task_lists(account)}
    calendars = {item.id: item.summary for item in state.runtime.storage.list_calendars(account)}
    records: list[ImportedRecord] = [
        *(_task_record(item, lists) for item in state.runtime.storage.list_tasks(account)),
        *(_event_record(item, calendars) for item in state.runtime.storage.list_events(account)),
    ]
    exporters = {"json": export_json, "csv": export_csv, "ics": export_ics}
    if format not in exporters:
        raise ValueError("export format must be json, csv, or ics")
    text = exporters[format](records)
    if output:
        output.write_text(text, encoding="utf-8")
        typer.echo(str(output))
    else:
        typer.echo(text, nl=not text.endswith("\n"))


# Authentication
@auth_app.command("connect")
def auth_connect(
    ctx: typer.Context,
    account_id: str,
    email: str,
    no_browser: bool = typer.Option(False, "--no-browser"),
) -> None:
    state = _state(ctx)
    result = state.runtime.authenticator.connect(account_id, open_browser=not no_browser)
    state.runtime.storage.upsert_account(Account(account_id, email))
    _emit(
        ctx,
        {"account_id": account_id, "email": email, "scopes": result.granted_scopes},
        human=lambda value: f"Connected {value['email']} ({value['account_id']})",
    )


@auth_app.command("status")
def auth_status(ctx: typer.Context) -> None:
    state = _state(ctx)
    rows = [
        {**to_primitive(item), "authenticated": state.runtime.token_store.get(item.id) is not None}
        for item in state.runtime.storage.list_accounts()
    ]
    _emit(
        ctx,
        rows,
        fields=("id", "email", "enabled", "authenticated"),
        human=lambda item: (
            f"{item['id']}\t{item['email']}\t"
            f"{'connected' if item['authenticated'] else 'disconnected'}"
        ),
    )


@auth_app.command("disconnect")
def auth_disconnect(
    ctx: typer.Context,
    account_id: str | None = typer.Argument(None),
    yes: bool = typer.Option(False, "--yes", "-y"),
) -> None:
    target = account_id or _account(ctx)
    _confirm(yes, f"Disconnect {target} and remove its local data?")
    state = _state(ctx)
    removed = state.runtime.authenticator.disconnect(target, storage=state.runtime.storage)
    _emit(
        ctx,
        {"account_id": target, "credentials_removed": removed},
        human=lambda value: f"Disconnected {value['account_id']}",
    )


# Configuration
@config_app.command("show")
def config_show(ctx: typer.Context) -> None:
    _emit(ctx, _state(ctx).runtime.config)


@config_app.command("path")
def config_path(ctx: typer.Context) -> None:
    typer.echo(str(_state(ctx).runtime.paths.config_file))


@config_app.command("init")
def config_init(ctx: typer.Context, force: bool = typer.Option(False, "--force")) -> None:
    target = _state(ctx).runtime.paths.config_file
    if target.exists() and not force:
        raise ValueError(f"{target} already exists; use --force to replace it")
    save(_state(ctx).runtime.config, target)
    typer.echo(str(target))


def _coerce_config(current: Any, raw: str) -> Any:
    if isinstance(current, bool):
        if raw.lower() not in {"true", "false"}:
            raise ValueError("boolean configuration values must be true or false")
        return raw.lower() == "true"
    if isinstance(current, int):
        return int(raw)
    if current is None:
        return None if raw.lower() == "none" else raw
    return raw


@config_app.command("set")
def config_set(ctx: typer.Context, key: str, value: str) -> None:
    if "." not in key:
        raise ValueError("configuration key must be SECTION.NAME")
    section_name, field = key.split(".", 1)
    state = _state(ctx)
    current = load(state.runtime.paths.config_file)
    if section_name not in {"preferences", "theme", "keys"}:
        raise ValueError(f"unknown configuration section {section_name!r}")
    section = getattr(current, section_name)
    if field not in section.__dataclass_fields__:
        raise ValueError(f"unknown configuration key {key!r}")
    updated_section = replace(section, **{field: _coerce_config(getattr(section, field), value)})
    updated = replace(current, **{section_name: updated_section})
    save(updated, state.runtime.paths.config_file)
    state.runtime.__dict__.pop("config", None)
    _emit(
        ctx,
        {"key": key, "value": getattr(updated_section, field)},
        human=lambda row: f"{row['key']}={row['value']}",
    )


@app.command("doctor")
def doctor(ctx: typer.Context) -> None:
    state = _state(ctx)
    diagnostics = state.runtime.application.diagnostics()
    diagnostics.update(
        {
            "config": state.runtime.paths.config_file.name,
            "config_valid": True,
            "color": not (
                os.environ.get("NO_COLOR") is not None or os.environ.get("TERM") == "dumb"
            ),
        }
    )
    _emit(
        ctx,
        diagnostics,
        human=lambda row: "\n".join(f"{key}: {value}" for key, value in row.items()),
    )


@daemon_app.command("status")
def daemon_status(ctx: typer.Context) -> None:
    state = DaemonState(_state(ctx).runtime.paths.cache_dir)
    running = False
    pid: int | None = None
    if state.pid_file.exists():
        try:
            pid = int(state.pid_file.read_text(encoding="ascii"))
            os.kill(pid, 0)
            running = True
        except (OSError, ValueError):
            pass
    detail: dict[str, Any] = {}
    if state.status_file.exists():
        try:
            loaded = json.loads(state.status_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                detail = {key: loaded[key] for key in ("status", "updated_at") if key in loaded}
        except (OSError, json.JSONDecodeError):
            detail = {"status": "invalid"}
    _emit(
        ctx,
        {"installed": _launch_agent_path().exists(), "running": running, "pid": pid, **detail},
        human=lambda value: (
            f"{'running' if value['running'] else 'stopped'}"
            f"{' (installed)' if value['installed'] else ''}"
        ),
    )


@daemon_app.command("install")
def daemon_install() -> None:
    if sys.platform != "darwin":
        raise HcbError("LaunchAgent installation is only available on macOS")
    import subprocess

    target = _launch_agent_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "Label": "com.hot-cross-buns.reminderd",
        "ProgramArguments": [sys.executable, "-m", "hcb.cli", "daemon", "run"],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "StandardOutPath": str(Path.home() / "Library/Logs/hcb-reminderd.log"),
        "StandardErrorPath": str(Path.home() / "Library/Logs/hcb-reminderd.log"),
    }
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(plistlib.dumps(payload))
    temporary.replace(target)
    subprocess.run(
        ["launchctl", "bootstrap", f"gui/{os.getuid()}", str(target)],
        check=False,
        capture_output=True,
    )
    typer.echo(str(target))


def _launch_agent_path() -> Path:
    return Path.home() / "Library/LaunchAgents/com.hot-cross-buns.reminderd.plist"


@daemon_app.command("uninstall")
def daemon_uninstall() -> None:
    if sys.platform != "darwin":
        raise HcbError("LaunchAgent installation is only available on macOS")
    import subprocess

    target = _launch_agent_path()
    subprocess.run(
        ["launchctl", "bootout", f"gui/{os.getuid()}", str(target)],
        check=False,
        capture_output=True,
    )
    target.unlink(missing_ok=True)
    typer.echo("uninstalled")


@daemon_app.command("run")
def daemon_run(
    ctx: typer.Context,
    once: bool = typer.Option(False, "--once", help="Scan and deliver once, then exit."),
) -> None:
    runtime = _state(ctx).runtime
    account = _account(ctx)
    preferences = runtime.config.preferences
    if not preferences.reminders_enabled:
        raise HcbError("local reminders are disabled in preferences")
    scheduler = ReminderScheduler(
        runtime.storage,
        default_notifier(),
        catch_up=timedelta(minutes=preferences.reminder_catch_up_minutes),
    )
    state = DaemonState(runtime.paths.cache_dir)
    state.write("running")
    try:
        if once:
            result = scheduler.run_once(account)
            state.write("idle")
            _emit(ctx, result)
            return
        sync_callback: Callable[[], object] | None = None
        if preferences.reminder_sync_interval_minutes and preferences.reminder_sync_mode != "off":
            engine = runtime.sync_engine(account)
            if preferences.reminder_sync_mode == "pull":
                def pull_sync() -> object:
                    return engine.sync_task_lists(account), engine.sync_calendars(account)

                sync_callback = pull_sync
            else:
                def full_sync() -> object:
                    return engine.sync(account)

                sync_callback = full_sync
        run_loop(
            scheduler,
            account,
            interval=preferences.reminder_poll_seconds,
            jitter=preferences.reminder_jitter_seconds,
            sync=sync_callback,
            sync_interval=preferences.reminder_sync_interval_minutes * 60,
        )
    except KeyboardInterrupt:
        state.write("stopped")
    finally:
        state.clear()


def main() -> None:
    if len(sys.argv) == 1:
        if sys.stdin.isatty() and sys.stdout.isatty():
            from .tui import run_tui

            run_tui(_runtime_factory())
            return
        typer.echo(
            "HCB's interactive workspace requires a TTY. Run `hcb --help` for scriptable commands.",
            err=True,
        )
        return
    app()


if __name__ == "__main__":
    main()
