"""Deterministic release-scale fixture and local performance measurements."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from time import perf_counter

from .application import ApplicationService
from .models import (
    Account,
    Calendar,
    DateTimeKind,
    Event,
    EventDateTime,
    Task,
    TaskList,
)
from .storage import Storage


@dataclass(frozen=True, slots=True)
class BenchmarkResult:
    cold_open_seconds: float
    search_10k_seconds: float
    agenda_seconds: float
    tui_cache_load_seconds: float
    search_results: int
    agenda_results: int
    cached_tasks: int
    cached_events: int

    def as_dict(self) -> dict[str, float | int]:
        return asdict(self)


def create_large_fixture(
    path: Path,
    *,
    task_count: int = 10_000,
    event_count: int = 2_000,
) -> None:
    """Create a stable, realistic local cache without network or random input."""
    with Storage(path) as storage, storage.transaction():
        storage.upsert_account(Account("benchmark", "redacted@example.test"))
        storage.upsert_task_list(TaskList("inbox", "benchmark", "Inbox"))
        storage.upsert_calendar(Calendar("primary", "benchmark", "Primary"))
        for index in range(task_count):
            marker = " release-marker" if index % 997 == 0 else ""
            storage.upsert_task(
                Task(
                    f"task-{index:05d}",
                    "benchmark",
                    "inbox",
                    f"Deterministic task {index:05d}{marker}",
                    notes=f"Local fixture note {index:05d}",
                )
            )
        origin = datetime(2026, 1, 1, 9, tzinfo=UTC)
        for index in range(event_count):
            start = origin + timedelta(hours=6 * index)
            storage.upsert_event(
                Event(
                    f"event-{index:05d}",
                    "benchmark",
                    "primary",
                    f"Fixture event {index:05d}",
                    EventDateTime(DateTimeKind.DATETIME, start, "UTC"),
                    EventDateTime(DateTimeKind.DATETIME, start + timedelta(minutes=45), "UTC"),
                )
            )


def measure_large_fixture(path: Path) -> BenchmarkResult:
    started = perf_counter()
    storage = Storage(path)
    cold_open = perf_counter() - started
    try:
        application = ApplicationService(storage)

        started = perf_counter()
        search = application.search("benchmark", "release-marker", limit=50)
        search_elapsed = perf_counter() - started

        started = perf_counter()
        agenda = storage.list_events(
            "benchmark",
            start=date(2026, 3, 1),
            end=date(2026, 4, 1),
        )
        agenda_elapsed = perf_counter() - started

        started = perf_counter()
        snapshot = application.workspace("benchmark")
        cache_elapsed = perf_counter() - started
        return BenchmarkResult(
            cold_open,
            search_elapsed,
            agenda_elapsed,
            cache_elapsed,
            len(search),
            len(agenda),
            len(snapshot.tasks),
            len(snapshot.events),
        )
    finally:
        storage.close()
