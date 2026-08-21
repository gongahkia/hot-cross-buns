from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from pathlib import Path

from textual.widgets import Input, ListView, Static

from hcb.config import Config, Theme, save
from hcb.models import Account, Conflict, DateTimeKind, EntityType, EventDateTime
from hcb.paths import AppPaths
from hcb.runtime import Runtime
from hcb.storage import Storage
from hcb.tui import (
    PALETTE_COMMANDS,
    CalendarScreen,
    ConflictScreen,
    EventEditorScreen,
    FindTimeScreen,
    HcbApp,
    ImportScreen,
    OnboardingScreen,
    PaletteScreen,
    RsvpScreen,
    ScheduleScreen,
    SettingsScreen,
)


def run[T](coro: Awaitable[T]) -> T:
    return asyncio.run(coro)


def seeded_runtime(tmp_path: Path, *, environ: dict[str, str] | None = None) -> Runtime:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    with Storage(paths.database_file) as storage:
        storage.upsert_account(Account("work", "me@example.com"))
    runtime = Runtime(paths, environ=environ or {})
    task_list = runtime.application.create_task_list("work", "Inbox")
    runtime.application.create_task("work", task_list.id, "Ship TUI", notes="Pilot coverage")
    runtime.application.create_calendar("work", "Personal")
    return runtime


def app_test(
    app: HcbApp,
    body: Callable[[object], Awaitable[None]],
    *,
    size: tuple[int, int] = (110, 34),
) -> None:
    async def scenario() -> None:
        async with app.run_test(size=size) as pilot:
            await pilot.pause()
            await body(pilot)

    run(scenario())


async def activate_palette(pilot: object, app: HcbApp, query_text: str) -> None:
    await pilot.press("/")  # type: ignore[attr-defined]
    await pilot.pause()  # type: ignore[attr-defined]
    query = app.screen.query_one("#palette-query", Input)
    query.value = query_text
    await pilot.pause()  # type: ignore[attr-defined]
    await pilot.press("enter")  # type: ignore[attr-defined]
    await pilot.pause()  # type: ignore[attr-defined]


def test_startup_surface_switching_and_narrow_layout(tmp_path: Path) -> None:
    app = HcbApp(seeded_runtime(tmp_path))

    async def assertions(pilot: object) -> None:
        assert "Tasks" in str(app.query_one("#surface-title", Static).render())
        assert len(app.query_one("#content", ListView).children) == 1
        await pilot.press("3")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.surface == "Agenda"
        await pilot.resize_terminal(58, 24)  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.has_class("very-narrow")
        assert app.query_one("#inspector").display is False

    app_test(app, assertions)


def test_palette_shows_commands_and_title_first_results(tmp_path: Path) -> None:
    app = HcbApp(seeded_runtime(tmp_path))

    async def assertions(pilot: object) -> None:
        await pilot.press("/")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert isinstance(app.screen, PaletteScreen)
        results = app.screen.query_one("#palette-results", ListView)
        assert len(results.children) == len(PALETTE_COMMANDS)
        query = app.screen.query_one("#palette-query", Input)
        query.value = "Ship"
        await pilot.pause()  # type: ignore[attr-defined]
        labels = [str(row.query_one("Label").render()) for row in results.children]
        assert any(label.startswith("Ship TUI") for label in labels)
        await pilot.press("escape")  # type: ignore[attr-defined]

    app_test(app, assertions)


def test_task_create_edit_complete_and_delete(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    database = runtime.paths.database_file
    app = HcbApp(runtime)

    async def actions(pilot: object) -> None:
        await pilot.press("n")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        app.screen.query_one("#editor-title", Input).value = "Created in TUI"
        await pilot.click("#save")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        rows = app.query_one("#content", ListView)
        rows.index = len(rows.children) - 1
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.press("space")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.press("d")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.press("y")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]

    app_test(app, actions)
    with Storage(database) as storage:
        assert all(task.title != "Created in TUI" for task in storage.list_tasks("work"))


def test_no_account_onboarding_is_actionable_and_offline(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    app = HcbApp(Runtime(paths, environ={}))

    async def assertions(pilot: object) -> None:
        assert app.account_id is None
        assert isinstance(app.screen, OnboardingScreen)
        state = str(app.query_one("#sync-state", Static).render())
        assert "no network activity" in state
        row = app.query_one("#content", ListView).children[0]
        assert "hcb auth connect" in str(row.query_one("Label").render())
        await pilot.press("escape")  # type: ignore[attr-defined]

    app_test(app, assertions)


def test_onboarding_offline_saves_non_secret_config_without_auth(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    app = HcbApp(Runtime(paths, environ={}))

    async def actions(pilot: object) -> None:
        assert isinstance(app.screen, OnboardingScreen)
        app.screen.query_one("#onboard-account", Input).value = "offline"
        app.screen.query_one("#onboard-email", Input).value = "offline@example.test"
        app.screen.query_one("#onboard-timezone", Input).value = "Asia/Singapore"
        app.screen.query_one("#onboard-theme", Input).value = "mono"
        app.screen.query_one("#onboard-reminders", Input).value = "false"
        await pilot.click("#onboard-offline")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.account_id == "offline"

    app_test(app, actions)
    reopened = Runtime(paths, environ={})
    assert reopened.config.preferences.time_zone == "Asia/Singapore"
    assert reopened.config.preferences.google_client_json == ""
    assert not reopened.config.preferences.reminders_enabled
    assert reopened.storage.get_account("offline") is not None
    reopened.close()


def test_onboarding_connect_waits_for_explicit_confirmation(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    client = tmp_path / "desktop.json"
    client.write_text('{"installed":{"client_id":"public-client"}}')
    runtime = Runtime(paths, environ={})
    calls: list[str] = []

    class Authenticator:
        def connect(self, account_id: str) -> None:
            calls.append(account_id)

    runtime.__dict__["authenticator"] = Authenticator()
    app = HcbApp(runtime)

    async def actions(pilot: object) -> None:
        app.screen.query_one("#onboard-client", Input).value = str(client)
        app.screen.query_one("#onboard-account", Input).value = "google"
        app.screen.query_one("#onboard-email", Input).value = "google@example.test"
        await pilot.click("#onboard-connect")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert calls == []
        await pilot.press("y")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert calls == ["google"]

    app_test(app, actions)
    assert "public-client" not in paths.config_file.read_text()


def test_no_color_forces_mono_ascii_and_disables_mouse(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    save(Config(theme=Theme(name="light", borders="unicode", mouse=True)), paths.config_file)
    app = HcbApp(Runtime(paths, environ={"NO_COLOR": "1"}))

    async def assertions(_: object) -> None:
        assert app.theme_mode == "mono"
        assert app.border_style == "ascii"
        assert not app.mouse_enabled
        assert app.has_class("theme-mono", "ascii", "no-mouse")

    app_test(app, assertions)


def test_event_modal_create_edit_rsvp_and_delete(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    database = runtime.paths.database_file
    calendar_id = runtime.application.workspace("work").calendars[0].id
    app = HcbApp(runtime, selected_date=date(2026, 8, 21))

    async def actions(pilot: object) -> None:
        await pilot.press("3")  # type: ignore[attr-defined]
        await pilot.press("n")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert isinstance(app.screen, EventEditorScreen)
        app.screen.query_one("#event-title", Input).value = "Planning"
        app.screen.query_one("#event-start", Input).value = "2026-08-21"
        app.screen.query_one("#event-end", Input).value = "2026-08-22"
        app.screen.query_one("#event-calendar", Input).value = calendar_id
        await pilot.click("#event-save")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.press("e")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        app.screen.query_one("#event-title", Input).value = "Updated planning"
        await pilot.click("#event-save")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.press("v")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert isinstance(app.screen, RsvpScreen)
        await pilot.click("#accepted")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.cache.pending >= 2
        await pilot.press("d")  # type: ignore[attr-defined]
        await pilot.press("y")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]

    app_test(app, actions)
    with Storage(database) as storage:
        assert storage.list_events("work") == []


def test_palette_calendar_and_settings_workflows(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    config_path = runtime.paths.config_file
    app = HcbApp(runtime)

    async def actions(pilot: object) -> None:
        await activate_palette(pilot, app, "Calendars")
        assert isinstance(app.screen, CalendarScreen)
        app.screen.query_one("#calendar-name", Input).value = "Team"
        await pilot.click("#calendar-add")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert any(row[1] == "Team" for row in app.calendar_rows())
        calendar_list = app.screen.query_one("#calendar-list", ListView)
        calendar_list.index = len(calendar_list.children) - 1
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.click("#calendar-toggle")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert next(row[2] for row in app.calendar_rows() if row[1] == "Team") is False
        calendar_list.index = len(calendar_list.children) - 1
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.click("#calendar-delete")  # type: ignore[attr-defined]
        await pilot.press("y")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert all(row[1] != "Team" for row in app.calendar_rows())
        await pilot.press("escape")  # type: ignore[attr-defined]
        await activate_palette(pilot, app, "Settings")
        assert isinstance(app.screen, SettingsScreen)
        app.screen.query_one("#setting-density", Input).value = "compact"
        app.screen.query_one("#setting-borders", Input).value = "ascii"
        app.screen.query_one("#setting-mouse", Input).value = "false"
        await pilot.click("#settings-save")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.has_class("density-compact", "ascii", "no-mouse")

    app_test(app, actions)
    saved = Runtime(app.runtime.paths, environ={}).config
    assert config_path.exists()
    assert saved.theme.density == "compact"
    assert saved.theme.borders == "ascii"
    assert not saved.theme.mouse


def test_palette_find_time_uses_only_cached_events(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    calendar_id = runtime.application.workspace("work").calendars[0].id
    runtime.application.create_event(
        "work",
        calendar_id,
        "Busy morning",
        EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 9, tzinfo=UTC)),
        EventDateTime(DateTimeKind.DATETIME, datetime(2026, 8, 21, 10, tzinfo=UTC)),
    )
    app = HcbApp(runtime, selected_date=date(2026, 8, 21))

    async def assertions(pilot: object) -> None:
        await activate_palette(pilot, app, "Find a time")
        assert isinstance(app.screen, FindTimeScreen)
        rows = app.screen.query_one("#find-results", ListView)
        labels = [str(row.query_one("Label").render()) for row in rows.children]
        assert labels[0].startswith("10:00")
        assert "never queried" in str(app.screen.query_one("#find-disclosure", Static).render())

    app_test(app, assertions)


def test_schedule_bulk_undo_redo_and_import_dialogs(
    tmp_path: Path,
) -> None:
    runtime = seeded_runtime(tmp_path)
    database = runtime.paths.database_file
    source = tmp_path / "import.json"
    source.write_text(
        '{"version":1,"records":[{"kind":"task","title":"Imported in TUI"}]}'
    )
    app = HcbApp(runtime)

    async def actions(pilot: object) -> None:
        task_id = app.cache.tasks[0].id
        app.selected = ("task", task_id)
        await activate_palette(pilot, app, "Schedule task")
        assert isinstance(app.screen, ScheduleScreen)
        app.screen.query_one("#schedule-start", Input).value = "2026-08-21T09:00:00Z"
        app.screen.query_one("#schedule-end", Input).value = "2026-08-21T10:00:00Z"
        await pilot.click("#schedule-save")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert runtime.application.list_task_event_links("work")
        await pilot.click("#schedule-remove")  # type: ignore[attr-defined]
        await pilot.press("y")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.click("#schedule-close")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]

        app.selected = ("task", task_id)
        app.marked = {task_id}
        await activate_palette(pilot, app, "Bulk actions")
        await pilot.click("#bulk-complete")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert runtime.storage.get_task("work", task_id).status.value == "completed"
        await pilot.press("u")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert runtime.storage.get_task("work", task_id).status.value == "needsAction"
        await pilot.press("ctrl+r")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert runtime.storage.get_task("work", task_id).status.value == "completed"

        await activate_palette(pilot, app, "Import")
        assert isinstance(app.screen, ImportScreen)
        app.screen.query_one("#import-path", Input).value = str(source)
        await pilot.click("#import-preview")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert "Accepted: 1" in str(
            app.screen.query_one("#import-summary", Static).render()
        )
        await pilot.click("#import-apply")  # type: ignore[attr-defined]
        await pilot.press("y")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]

    app_test(app, actions)
    with Storage(database) as storage:
        assert any(task.title == "Imported in TUI" for task in storage.list_tasks("work"))


def test_conflict_resolution_and_explicit_remote_freebusy(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    runtime.storage.add_conflict(
        Conflict(None, "work", EntityType.TASK, "task", {"body": {}}, {"body": {}})
    )
    calls: list[dict[str, object]] = []

    class Gateway:
        def freebusy(self, body: dict[str, object]) -> dict[str, object]:
            calls.append(body)
            return {"calendars": {"primary": {"busy": [{"start": "a", "end": "b"}]}}}

    class Engine:
        gateway = Gateway()

    runtime.sync_engine = lambda _account: Engine()  # type: ignore[method-assign,assignment]
    app = HcbApp(runtime, selected_date=date(2026, 8, 21))

    async def actions(pilot: object) -> None:
        await activate_palette(pilot, app, "Conflicts")
        assert isinstance(app.screen, ConflictScreen)
        await pilot.click("#conflict-remote")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert runtime.storage.list_conflicts("work") == []

        await activate_palette(pilot, app, "Find a time")
        assert isinstance(app.screen, FindTimeScreen)
        await pilot.click("#find-remote")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert calls
        assert "Explicit Google free/busy" in str(
            app.screen.query_one("#find-disclosure", Static).render()
        )

    app_test(app, actions)
