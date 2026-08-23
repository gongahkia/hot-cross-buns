from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from pathlib import Path

from rich.style import Style
from rich.text import Text
from textual import events
from textual.app import SuspendNotSupported
from textual.widgets import Button, Input, Label, ListView, Select, Static

from hcb.config import Config, Theme, ThemeColors, save
from hcb.models import (
    Account,
    Conflict,
    DateTimeKind,
    DriveFile,
    EntityType,
    EventDateTime,
    Preferences,
)
from hcb.paths import AppPaths
from hcb.runtime import Runtime
from hcb.storage import Storage
from hcb.tui import (
    PALETTE_COMMANDS,
    CalendarScreen,
    ConflictScreen,
    EditorScreen,
    EntityRow,
    EventEditorScreen,
    FindTimeScreen,
    GoogleSetupScreen,
    HcbApp,
    ImportScreen,
    LoadingScreen,
    OnboardingScreen,
    PaletteScreen,
    RsvpScreen,
    ScheduleScreen,
    SettingsScreen,
    TerminalTextArea,
    emoji_suggestions,
    linkify_urls,
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


def test_workspace_splitters_resize_columns_and_respect_narrow_layout(tmp_path: Path) -> None:
    app = HcbApp(seeded_runtime(tmp_path))

    async def assertions(pilot: object) -> None:
        sidebar = app.query_one("#sidebar")
        inspector = app.query_one("#inspector")
        sidebar_width = sidebar.size.width
        inspector_width = inspector.size.width

        await pilot.press("ctrl+alt+right", "ctrl+alt+right")  # type: ignore[attr-defined]
        await pilot.press("ctrl+alt+shift+left", "ctrl+alt+shift+left")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert sidebar.size.width == sidebar_width + 4
        assert inspector.size.width == inspector_width + 4

        await pilot.mouse_down("#sidebar-resize", offset=(0, 4))  # type: ignore[attr-defined]
        await pilot.mouse_up("#center", offset=(5, 4))  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert sidebar.size.width > sidebar_width + 4
        assert app._resize_target is None

        await pilot.resize_terminal(58, 24)  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.query_one("#sidebar-resize", Static).display is False
        assert app.query_one("#inspector-resize", Static).display is False

    app_test(app, assertions, size=(120, 34))


def test_notes_surface_handles_tasks_without_notes(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    task_list = runtime.storage.list_task_lists("work")[0]
    runtime.application.create_task("work", task_list.id, "Untitled note")
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        app.action_surface("Notes")
        await pilot.pause()  # type: ignore[attr-defined]
        rows = app.query_one("#content", ListView).children
        labels = [str(row.query_one("Label").render()) for row in rows]
        assert any("Untitled note" in label for label in labels)

    app_test(app, assertions)


def test_agenda_uses_the_configured_friendly_date_time_format(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    save(
        Config(preferences=Preferences(time_zone="Asia/Singapore", date_time_format="friendly")),
        runtime.paths.config_file,
    )
    calendar_id = runtime.storage.list_calendars("work")[0].id
    runtime.application.create_event(
        "work",
        calendar_id,
        "Evening meeting",
        EventDateTime(DateTimeKind.DATETIME, datetime(2026, 5, 26, 11, 23, tzinfo=UTC)),
        EventDateTime(DateTimeKind.DATETIME, datetime(2026, 5, 26, 12, 23, tzinfo=UTC)),
    )
    app = HcbApp(runtime, selected_date=date(2026, 5, 25))

    async def assertions(pilot: object) -> None:
        await pilot.press("3")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        rows = app.query_one("#content", ListView).children
        labels = [str(row.query_one("Label").render()) for row in rows]
        assert any("26 May 2026, 7:23pm" in label for label in labels), labels
        assert all("T11:23:00" not in label for label in labels)

    app_test(app, assertions)


def test_links_in_workspace_text_open_only_safe_web_urls(tmp_path: Path) -> None:
    url = "https://example.test/guide"
    linked = linkify_urls(f"Read {url}.")
    assert linked.plain == f"Read {url}."
    assert [span.style.link for span in linked.spans] == [url]

    opened: list[str] = []
    app = HcbApp(seeded_runtime(tmp_path), url_opener=lambda target: opened.append(target) or True)

    async def assertions(_: object) -> None:
        app.on_click(events.Click(app, 0, 0, 0, 0, 1, False, False, False, style=Style(link=url)))
        app.on_click(
            events.Click(
                app, 0, 0, 0, 0, 1, False, False, False, style=Style(link="file:///tmp/no")
            )
        )
        assert opened == [url]

    app_test(app, assertions)


def test_inspector_links_event_attachments_and_drive_files(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    calendar_id = runtime.storage.list_calendars("work")[0].id
    description_url = "https://example.test/event-notes"
    attachment_url = "https://drive.google.com/open?id=attachment"
    drive_url = "https://drive.google.com/open?id=file"
    event = runtime.application.create_event(
        "work",
        calendar_id,
        "Planning",
        EventDateTime(DateTimeKind.DATE, date(2026, 8, 24)),
        EventDateTime(DateTimeKind.DATE, date(2026, 8, 25)),
        description=f"Read {description_url}",
        attachments=({"title": "Planning brief", "fileUrl": attachment_url},),
    )
    runtime.storage.upsert_drive_file(
        DriveFile("brief", "work", "Planning brief", "application/pdf", drive_url)
    )
    app = HcbApp(runtime, selected_date=date(2026, 8, 24))

    def targets(value: object) -> set[str]:
        assert isinstance(value, Text)
        return {
            span.style.link
            for span in value.spans
            if isinstance(span.style, Style) and span.style.link
        }

    async def assertions(pilot: object) -> None:
        app.selected = ("event", event.id)
        app._render_inspector()
        await pilot.pause()  # type: ignore[attr-defined]
        assert {description_url, attachment_url} <= targets(
            app.query_one("#inspection", Static).content
        )

        app.selected = ("drive", "brief")
        app._render_inspector()
        assert drive_url in targets(app.query_one("#inspection", Static).content)

    app_test(app, assertions)


def test_content_selection_persistently_marks_the_inspected_row(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    task_list = runtime.storage.list_task_lists("work")[0]
    runtime.application.create_task("work", task_list.id, "Second task")
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        content = app.query_one("#content", ListView)
        rows = tuple(content.query(EntityRow))

        content.index = 1
        await pilot.pause()  # type: ignore[attr-defined]

        assert app.selected == ("task", rows[1].item_id)
        assert rows[1].has_class("hcb-selected")
        assert not rows[0].has_class("hcb-selected")

        app.query_one("#resources", ListView).focus()
        await pilot.pause()  # type: ignore[attr-defined]
        assert rows[1].has_class("hcb-selected")

    app_test(app, assertions)


def test_resource_selection_persistently_marks_the_active_filter(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    task_list = runtime.application.create_task_list("work", "Plans")
    calendar = runtime.application.create_calendar("work", "Work")
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        resources = app.query_one("#resources", ListView)
        rows = tuple(resources.query(EntityRow))
        all_resources = next(row for row in rows if row.kind == "resource-all")
        plans = next(row for row in rows if row.item_id == task_list.id)
        work = next(row for row in rows if row.item_id == calendar.id)

        assert all_resources.has_class("hcb-selected")
        assert not plans.has_class("hcb-selected")

        app.resource_filter = ("task-list", task_list.id)
        app._render_chrome(refresh_resources=False)
        await pilot.pause()  # type: ignore[attr-defined]
        assert plans.has_class("hcb-selected")
        assert not all_resources.has_class("hcb-selected")

        app.resource_filter = ("calendar", calendar.id)
        app._render_chrome(refresh_resources=False)
        app.query_one("#content", ListView).focus()
        await pilot.pause()  # type: ignore[attr-defined]
        assert work.has_class("hcb-selected")
        assert not plans.has_class("hcb-selected")

    app_test(app, assertions)


def test_text_editors_have_a_persistent_high_contrast_block_cursor(tmp_path: Path) -> None:
    app = HcbApp(seeded_runtime(tmp_path))

    async def assertions(pilot: object) -> None:
        await pilot.press("n")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        title = app.screen.query_one("#editor-title", Input)
        notes = app.screen.query_one("#editor-notes", TerminalTextArea)
        assert title.has_focus
        assert not title.cursor_blink
        assert not notes.cursor_blink
        cursor = title.get_component_rich_style("input--cursor")
        assert cursor.bgcolor is not None and cursor.bgcolor.number == 7
        assert cursor.color is not None and cursor.color.number == 0

    app_test(app, assertions)


def test_text_editors_complete_rich_emoji_names_and_aliases(tmp_path: Path) -> None:
    app = HcbApp(seeded_runtime(tmp_path))
    alias = emoji_suggestions(":+1", 3)
    assert alias is not None and ("+1", "👍") in alias[1]

    async def assertions(pilot: object) -> None:
        await pilot.press("n")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        title = app.screen.query_one("#editor-title", Input)
        await pilot.press(":", "s", "m", "i")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        popup = app.screen.query_one("#emoji-completion", Static)
        assert ":smile: 😄" in str(popup.render())
        assert app._emoji_selection == 0
        await pilot.press("down")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app._emoji_selection == 1
        await pilot.press("tab")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert title.value == "😸"
        assert not popup.display

        title.value = ":heart"
        title.cursor_position = len(title.value)
        await pilot.pause()  # type: ignore[attr-defined]
        assert popup.display
        await pilot.press("escape")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert isinstance(app.screen, EditorScreen)
        assert title.value == ":heart"
        assert not popup.display

        notes = app.screen.query_one("#editor-notes", TerminalTextArea)
        notes.focus()
        notes.load_text("Before :heart")
        notes.cursor_location = notes.document.end
        await pilot.pause()  # type: ignore[attr-defined]
        await pilot.press("enter")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert notes.text == "Before ❤"

    app_test(app, assertions)


def test_external_editor_replaces_shared_input_widgets(tmp_path: Path) -> None:
    commands: list[list[str]] = []
    temporary_files: list[Path] = []
    contents = iter(("first\nsecond\n", "one\n\ntwo\n"))
    suspensions: list[bool] = []

    @contextmanager
    def suspended() -> Iterator[None]:
        suspensions.append(True)
        yield

    def run_editor(command: list[str]) -> int:
        commands.append(command)
        path = Path(command[-1])
        temporary_files.append(path)
        path.write_text(next(contents), encoding="utf-8")
        return 0

    app = HcbApp(
        seeded_runtime(tmp_path, environ={"HCB_EDITOR": "vim -n"}),
        editor_runner=run_editor,
        suspend=suspended,
    )

    async def assertions(pilot: object) -> None:
        app.action_external_editor()
        assert not commands
        await pilot.press("n")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        title = app.screen.query_one("#editor-title", Input)
        title.value = "original"
        await pilot.press("ctrl+g")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert title.value == "first second"
        notes = app.screen.query_one("#editor-notes", TerminalTextArea)
        notes.focus()
        await pilot.press("ctrl+g")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert notes.text == "one\n\ntwo\n"

    app_test(app, assertions)
    assert [command[:-1] for command in commands] == [["vim", "-n"], ["vim", "-n"]]
    assert len(suspensions) == 2
    assert all(not path.exists() for path in temporary_files)


def test_external_editor_failure_leaves_input_unchanged(tmp_path: Path) -> None:
    notifications: list[str] = []

    @contextmanager
    def suspended() -> Iterator[None]:
        yield

    def run_editor(command: list[str]) -> int:
        Path(command[-1]).write_text("changed", encoding="utf-8")
        return 9

    app = HcbApp(seeded_runtime(tmp_path), editor_runner=run_editor, suspend=suspended)

    async def assertions(pilot: object) -> None:
        original_notify = app.notify

        def record_notification(message: object, **kwargs: object) -> None:
            notifications.append(str(message))
            original_notify(message, **kwargs)

        app.notify = record_notification  # type: ignore[method-assign]
        await pilot.press("n")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        title = app.screen.query_one("#editor-title", Input)
        title.value = "original"
        await pilot.press("ctrl+g")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert title.value == "original"

    app_test(app, assertions)
    assert "External editor exited with status 9" in notifications


def test_external_editor_reports_unsupported_suspension(tmp_path: Path) -> None:
    notifications: list[str] = []

    def unsupported() -> None:
        raise SuspendNotSupported("unsupported")

    app = HcbApp(
        seeded_runtime(tmp_path),
        editor_runner=lambda command: (_ for _ in ()).throw(AssertionError(command)),
        suspend=unsupported,  # type: ignore[arg-type]
    )

    async def assertions(pilot: object) -> None:
        original_notify = app.notify

        def record_notification(message: object, **kwargs: object) -> None:
            notifications.append(str(message))
            original_notify(message, **kwargs)

        app.notify = record_notification  # type: ignore[method-assign]
        await pilot.press("n")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        title = app.screen.query_one("#editor-title", Input)
        title.value = "original"
        await pilot.press("ctrl+g")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert title.value == "original"

    app_test(app, assertions)
    assert "External editor is unavailable in this environment" in notifications


def test_event_surface_marks_stale_instance_cache_ranges(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    calendar_id = runtime.storage.list_calendars("work")[0].id
    start = datetime(2026, 8, 21, tzinfo=UTC)
    runtime.storage.replace_cached_instances("work", calendar_id, start, start.replace(day=28), [])
    runtime.storage.mark_instance_ranges_stale(
        "work", calendar_id, reason="local-recurring-event-updated"
    )
    app = HcbApp(runtime, selected_date=date(2026, 8, 21))

    async def assertions(pilot: object) -> None:
        await pilot.press("3")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        cache_state = str(app.query_one("#sync-state", Static).render())
        assert "instances: stale" in cache_state
        assert "local recurring event updated" in cache_state
        assert "21 August 2026" in cache_state

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


def test_palette_searches_indexed_drive_files_and_opens_their_inspector(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    runtime.storage.upsert_drive_file(
        DriveFile(
            "brief",
            "work",
            "Quarterly brief workspaceunique",
            "application/pdf",
            "https://example.test/brief",
        )
    )
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        await pilot.press("/")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        query = app.screen.query_one("#palette-query", Input)
        query.value = "workspaceunique"
        await pilot.pause()  # type: ignore[attr-defined]
        labels = [
            str(row.query_one("Label").render())
            for row in app.screen.query_one("#palette-results", ListView).children
        ]
        assert labels == ["Quarterly brief workspaceunique  · drive"]
        await pilot.press("enter")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.selected == ("drive", "brief")
        assert "application/pdf" in str(app.query_one("#inspection", Static).render())

    app_test(app, assertions)


def test_palette_workspace_result_navigation_for_lists_calendars_saved_searches_and_conflicts(
    tmp_path: Path,
) -> None:
    runtime = seeded_runtime(tmp_path)
    task_list = runtime.application.create_task_list("work", "Research")
    calendar = runtime.application.create_calendar("work", "Travel")
    saved = runtime.application.save_search(
        "work", "Open research", "list:Research completed:false"
    )
    runtime.storage.add_conflict(
        Conflict(None, "work", EntityType.TASK, "missing", {"title": "L"}, {"title": "R"})
    )
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        app._palette_result(("task-list", task_list.id))
        assert app.surface == "Tasks"
        assert app.resource_filter == ("task-list", task_list.id)

        app._palette_result(("calendar", calendar.id))
        assert app.surface == "Agenda"
        assert app.resource_filter == ("calendar", calendar.id)

        app._palette_result(("saved-search", saved.id))
        await pilot.pause()  # type: ignore[attr-defined]
        assert isinstance(app.screen, PaletteScreen)
        assert app.screen.query_one("#palette-query", Input).value == saved.query
        await pilot.press("escape")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]

        app._palette_result(("conflict", "1"))
        await pilot.pause()  # type: ignore[attr-defined]
        assert isinstance(app.screen, ConflictScreen)

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
        assert (
            app.screen.query_one("#onboard-env-file", Input).value == "~/.config/hcb/personal.env"
        )
        labels = [str(label.render()) for label in app.screen.query(".onboarding-field Label")]
        assert labels == [
            "Credential .env path",
            "Local account identifier",
            "Account email",
            "Time zone",
            "Reminders",
        ]
        assert app.screen.query_one("#onboard-timezone", Select).value == "UTC"
        assert app.screen.query_one("#onboard-reminders", Select).value == "true"
        assert app.screen.query_one("#onboard-offline", Button).display
        assert app.screen.query_one("#onboard-connect", Button).display
        state = str(app.query_one("#sync-state", Static).render())
        assert "no network activity" in state
        row = app.query_one("#content", ListView).children[0]
        assert "hcb auth connect" in str(row.query_one("Label").render())
        await pilot.press("escape")  # type: ignore[attr-defined]

    app_test(app, assertions, size=(58, 24))


def test_onboarding_offline_saves_non_secret_config_without_auth(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    app = HcbApp(Runtime(paths, environ={}))

    async def actions(pilot: object) -> None:
        assert isinstance(app.screen, OnboardingScreen)
        app.screen.query_one("#onboard-account", Input).value = "offline"
        app.screen.query_one("#onboard-email", Input).value = "offline@example.test"
        app.screen.query_one("#onboard-timezone", Select).value = "Asia/Singapore"
        app.screen.query_one("#onboard-reminders", Select).value = "false"
        await pilot.click("#onboard-offline")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.account_id == "offline"

    app_test(app, actions)
    reopened = Runtime(paths, environ={})
    assert reopened.config.preferences.time_zone == "Asia/Singapore"
    assert "google_client_json" not in paths.config_file.read_text()
    assert not reopened.config.preferences.reminders_enabled
    assert reopened.storage.get_account("offline") is not None
    reopened.close()


def test_onboarding_connect_waits_for_explicit_confirmation(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    credential_file = tmp_path / "google.env"
    credential_file.write_text("HCB_GOOGLE_CLIENT_ID=public-client\n")
    credential_file.chmod(0o600)
    runtime = Runtime(paths, environ={})
    calls: list[str] = []

    class Authenticator:
        def connect(self, account_id: str) -> None:
            calls.append(account_id)

    runtime.__dict__["authenticator"] = lambda _account: Authenticator()
    app = HcbApp(runtime)

    async def actions(pilot: object) -> None:
        app.screen.query_one("#onboard-env-file", Input).value = str(credential_file)
        app.screen.query_one("#onboard-account", Input).value = "google"
        app.screen.query_one("#onboard-email", Input).value = "google@example.test"
        await pilot.click("#onboard-connect")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert calls == []
        assert app.screen.query_one("#confirm", Button).label == "Connect"
        await pilot.press("y")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert calls == ["google"]

    app_test(app, actions)
    assert "public-client" not in paths.config_file.read_text()


def test_no_color_forces_mono_ascii_and_disables_mouse(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    save(Config(theme=Theme(profile="light", borders="unicode", mouse=True)), paths.config_file)
    app = HcbApp(Runtime(paths, environ={"NO_COLOR": "1"}))

    async def assertions(_: object) -> None:
        assert app.theme_mode == "mono"
        assert app.border_style == "ascii"
        assert not app.mouse_enabled
        assert app.has_class("theme-mono", "ascii", "no-mouse")

    app_test(app, assertions)


def test_visual_config_live_reloads_and_invalid_edits_keep_last_theme(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    app = HcbApp(runtime)
    notifications: list[str] = []

    async def assertions(pilot: object) -> None:
        original_theme = app.theme
        original_notify = app.notify

        def record_notification(message: object, **kwargs: object) -> None:
            notifications.append(str(message))
            original_notify(message, **kwargs)

        app.notify = record_notification  # type: ignore[method-assign]
        save(
            Config(
                theme=Theme(colors=ThemeColors(focus="cyan", border="yellow", accent="magenta"))
            ),
            runtime.paths.config_file,
        )
        await asyncio.sleep(0.7)
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.theme != original_theme
        assert runtime.config.theme.colors.focus == "cyan"
        current_theme = app.theme

        runtime.paths.config_file.write_text('{"theme":{"colors":{"focus":"bad"}}}')
        await asyncio.sleep(0.7)
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.theme == current_theme
        assert runtime.config.theme.colors.focus == "cyan"
        assert any("config.json not applied" in message for message in notifications)

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
        for selector in (
            "#setting-profile",
            "#setting-density",
            "#setting-borders",
            "#setting-focus",
            "#setting-mouse",
            "#setting-week",
            "#setting-date-time-format",
        ):
            assert isinstance(app.screen.query_one(selector), Select)
        app.screen.query_one("#setting-density", Select).value = "compact"
        app.screen.query_one("#setting-borders", Select).value = "ascii"
        app.screen.query_one("#setting-mouse", Select).value = "false"
        app.screen.query_one("#setting-date-time-format", Select).value = "friendly_24h"
        app.screen.query_one("#setting-editor", Input).value = "hx"
        app.screen.query_one("#setting-external-editor", Input).value = "ctrl+o"
        app.screen.query_one("#setting-loader", Select).value = "emoji.weather"
        await pilot.click("#settings-save")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.has_class("density-compact", "ascii", "no-mouse")

    app_test(app, actions)
    saved = Runtime(app.runtime.paths, environ={}).config
    assert config_path.exists()
    assert saved.theme.density == "compact"
    assert saved.theme.borders == "ascii"
    assert not saved.theme.mouse
    assert saved.theme.loader == "emoji.weather"
    assert saved.preferences.date_time_format == "friendly_24h"
    assert saved.preferences.editor == "hx"
    assert saved.keys.external_editor == "ctrl+o"


def test_loading_surface_renders_the_selected_rattles_loader(tmp_path: Path) -> None:
    app = HcbApp(seeded_runtime(tmp_path))

    async def assertions(pilot: object) -> None:
        app.start_loading("Syncing with Google")
        await pilot.pause()  # type: ignore[attr-defined]
        assert isinstance(app.screen, LoadingScreen)
        loader = app.screen.query_one("#rattles-loader", Static)
        assert str(loader.render()).strip() in {"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
        app.update_loading("Fetching task lists")
        assert (
            str(app.screen.query_one("#loading-message", Label).render()) == "Fetching task lists"
        )
        app.stop_loading()
        await pilot.pause()  # type: ignore[attr-defined]
        assert not isinstance(app.screen, LoadingScreen)

    app_test(app, assertions)


def test_loading_progress_keeps_the_resource_list_and_selection_stable(tmp_path: Path) -> None:
    app = HcbApp(seeded_runtime(tmp_path))

    async def assertions(pilot: object) -> None:
        resources = app.query_one("#resources", ListView)
        before = tuple(resources.children)
        resources.index = 1
        app.resource_filter = ("task-list", before[1].item_id)

        app.start_loading("Syncing with Google")
        await pilot.pause()  # type: ignore[attr-defined]
        app.update_loading("Fetching task lists")
        app.stop_loading()
        await pilot.pause()  # type: ignore[attr-defined]

        assert tuple(resources.children) == before
        assert resources.index == 1
        assert app.resource_filter == ("task-list", before[1].item_id)

    app_test(app, assertions)


def test_unicode_chrome_keeps_a_content_row_and_single_edge_dividers(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    save(Config(theme=Theme(borders="unicode")), runtime.paths.config_file)
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        topbar = app.query_one("#topbar", Static)
        tabs = app.query_one("#tabs")
        sidebar_resize = app.query_one("#sidebar-resize", Static)

        assert topbar.content_size.height >= 1
        assert tabs.content_size.height >= 1
        assert topbar.styles.border_top[0] == ""
        assert topbar.styles.border_bottom[0] == "solid"
        assert sidebar_resize.styles.border_left[0] == "solid"
        assert sidebar_resize.styles.border_top[0] == ""

    app_test(app, assertions)


def test_ascii_chrome_keeps_a_visible_title_and_bottom_divider(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    save(Config(theme=Theme(borders="ascii")), runtime.paths.config_file)
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        topbar = app.query_one("#topbar", Static)

        assert topbar.content_size.height >= 1
        assert "HCB" in str(topbar.render())
        assert topbar.styles.border_top[0] == ""
        assert topbar.styles.border_bottom[0] == "ascii"

    app_test(app, assertions)


def test_mini_month_click_selects_a_day_without_rebuilding_resources(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    save(Config(theme=Theme(borders="unicode")), runtime.paths.config_file)
    app = HcbApp(runtime, selected_date=date(2026, 8, 23))

    async def assertions(pilot: object) -> None:
        resources = app.query_one("#resources", ListView)
        before = tuple(resources.children)

        await pilot.click("#mini-month", offset=(1, 3))  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]

        assert app.selected_date == date(2026, 8, 3)
        assert tuple(resources.children) == before
        assert "Monday, 03 August 2026" in str(app.query_one("#surface-title", Static).render())

    app_test(app, assertions)


def test_mini_month_visibly_marks_the_selected_day(tmp_path: Path) -> None:
    app = HcbApp(seeded_runtime(tmp_path), selected_date=date(2026, 8, 23))

    async def assertions(pilot: object) -> None:
        text = app.query_one("#mini-month", Static).content
        assert isinstance(text, Text)
        assert any(
            text.plain[span.start : span.end] == "23"
            and span.style == Style(bold=True, reverse=True)
            for span in text.spans
        )

    app_test(app, assertions)


def test_sync_worker_uses_an_isolated_sqlite_connection(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    original_storage = runtime.storage
    engines: list[object] = []

    class Result:
        pulled = 0
        pushed = 0

    class Engine:
        def __init__(self) -> None:
            self.storage = original_storage

        def sync(self, account_id: str, *, progress: Callable[[str], None] | None = None) -> Result:
            assert self.storage is not original_storage
            assert self.storage.get_account(account_id) is not None
            assert progress is not None
            progress("Fetching task lists")
            return Result()

    def sync_engine(_: str) -> Engine:
        engine = Engine()
        engines.append(engine)
        return engine

    runtime.sync_engine = sync_engine  # type: ignore[method-assign,assignment]
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        app.action_sync()
        for _ in range(20):
            await asyncio.sleep(0.01)
            await pilot.pause()  # type: ignore[attr-defined]
            if engines and not isinstance(app.screen, LoadingScreen):
                break
        assert engines
        assert not isinstance(app.screen, LoadingScreen)

    app_test(app, assertions)


def test_sync_without_google_credentials_shows_recovery_steps(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    runtime.credential_file_override = tmp_path / "missing-google.env"
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        app.action_sync()
        for _ in range(30):
            await asyncio.sleep(0.01)
            await pilot.pause()  # type: ignore[attr-defined]
            if isinstance(app.screen, GoogleSetupScreen):
                break
        assert isinstance(app.screen, GoogleSetupScreen)
        guidance = str(app.screen.query_one("#google-setup-guidance", Static).render())
        assert "Desktop OAuth client" in guidance
        assert "HCB_GOOGLE_CLIENT_ID" in guidance
        assert str(runtime.credential_file("work")) in guidance
        assert "hcb --env-file" in guidance
        assert "auth connect work me@example.com" in guidance

    app_test(app, assertions)


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
    source.write_text('{"version":1,"records":[{"kind":"task","title":"Imported in TUI"}]}')
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
        assert "Accepted: 1" in str(app.screen.query_one("#import-summary", Static).render())
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
        for _ in range(20):
            await pilot.pause()  # type: ignore[attr-defined]
            if calls:
                break
        assert calls
        assert isinstance(app.screen, FindTimeScreen)
        assert "Explicit Google free/busy" in str(
            app.screen.query_one("#find-disclosure", Static).render()
        )

    app_test(app, actions)


def test_resize_preserves_unicode_selection_and_restores_inspector(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    task_list_id = runtime.application.workspace("work").task_lists[0].id
    for index in range(35):
        runtime.application.create_task(
            "work",
            task_list_id,
            f"長い予定 🚆 item {index:02d}",
        )
    app = HcbApp(runtime)

    async def assertions(pilot: object) -> None:
        rows = app.query_one("#content", ListView)
        rows.index = len(rows.children) - 1
        await pilot.pause()  # type: ignore[attr-defined]
        selected = rows.highlighted_child
        assert selected is not None
        selected_id = selected.item_id
        assert "長い予定" in str(selected.query_one("Label").render())

        await pilot.resize_terminal(44, 18)  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert app.has_class("very-narrow")
        assert rows.highlighted_child is not None
        assert rows.highlighted_child.item_id == selected_id
        assert app.query_one("#inspector").display is False

        await pilot.resize_terminal(120, 38)  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert not app.has_class("narrow")
        assert rows.highlighted_child is not None
        assert rows.highlighted_child.item_id == selected_id
        assert app.query_one("#inspector").display is True

    app_test(app, assertions)


def test_tui_uncertain_delivery_requires_explicit_remote_id(tmp_path: Path) -> None:
    runtime = seeded_runtime(tmp_path)
    task = runtime.application.workspace("work").tasks[0]
    runtime.storage.connection.execute(
        "DELETE FROM outbox WHERE account_id=? AND entity_id=?",
        ("work", task.id),
    )
    runtime.storage.add_conflict(
        Conflict(
            None,
            "work",
            EntityType.TASK,
            task.id,
            {
                "kind": "uncertain-delivery",
                "mutation": {
                    "entity_type": "task",
                    "entity_id": task.id,
                    "operation": "create",
                    "payload": {
                        "list_id": task.list_id,
                        "body": {"title": task.title},
                    },
                    "request_id": None,
                },
            },
            {"kind": "delivery-status-unknown"},
        )
    )
    app = HcbApp(runtime)

    async def actions(pilot: object) -> None:
        await activate_palette(pilot, app, "Conflicts")
        assert isinstance(app.screen, ConflictScreen)
        app.screen.query_one("#conflict-remote-id", Input).value = "remote-task-id"
        await pilot.click("#conflict-remote")  # type: ignore[attr-defined]
        await pilot.pause()  # type: ignore[attr-defined]
        assert runtime.storage.list_conflicts("work") == []
        assert runtime.storage.get_task("work", task.id).remote_id == "remote-task-id"

    app_test(app, actions)
