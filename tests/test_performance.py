import asyncio
from pathlib import Path
from time import perf_counter

from hcb.benchmarks import create_large_fixture, measure_large_fixture
from hcb.models import Account, Task, TaskList
from hcb.paths import AppPaths
from hcb.runtime import Runtime
from hcb.storage import Storage
from hcb.tui import HcbApp, WorkspaceTable


def test_deterministic_large_fixture_local_performance(tmp_path: Path) -> None:
    database = tmp_path / "large.db"
    create_large_fixture(database)
    result = measure_large_fixture(database)

    assert result.search_results == 11
    assert result.agenda_results > 100
    assert result.cached_tasks == 10_000
    assert result.cached_events == 2_000

    # These are regression tripwires, not microbenchmarks. The generous limits
    # tolerate shared CI runners while still detecting accidental quadratic work.
    assert result.cold_open_seconds < 5.0
    assert result.search_10k_seconds < 0.25
    assert result.agenda_seconds < 5.0
    assert result.tui_cache_load_seconds < 5.0


def test_virtual_workspace_switches_ten_thousand_rows_without_row_widgets(tmp_path: Path) -> None:
    """Keep the large-workspace path on the virtual-table scalability boundary."""

    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    with Storage(paths.database_file) as storage, storage.transaction():
        storage.upsert_account(Account("work", "performance@example.test"))
        storage.upsert_task_list(TaskList("inbox", "work", "Inbox"))
        for index in range(10_000):
            storage.upsert_task(Task(f"task-{index}", "work", "inbox", f"Task {index:05d}"))

    async def scenario() -> tuple[float, float, int, int]:
        app = HcbApp(Runtime(paths, environ={}))
        async with app.run_test(size=(120, 40)) as pilot:
            await pilot.pause()
            content = app.query_one("#content", WorkspaceTable)
            mounted_before = len(tuple(content.walk_children()))
            started = perf_counter()
            app.action_surface("Agenda")
            await pilot.pause()
            to_agenda = perf_counter() - started
            started = perf_counter()
            app.action_surface("Tasks")
            await pilot.pause()
            to_tasks = perf_counter() - started
            return to_agenda, to_tasks, content.row_count, mounted_before

    to_agenda, to_tasks, row_count, mounted_before = asyncio.run(scenario())
    assert row_count == 10_000
    assert mounted_before < 20
    # Generous CI tripwires: local development should be materially faster.
    assert to_agenda < 1.0
    assert to_tasks < 1.0
