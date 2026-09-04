"""Deterministic release-scale fixture and local performance measurements."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from time import perf_counter
from zoneinfo import ZoneInfo

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
from .tui_calendar import all_day_blocks, calendar_items, calendar_range, timed_blocks


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
    calendar_week_layout_seconds: float
    calendar_month_layout_seconds: float
    calendar_week_blocks: int
    calendar_month_blocks: int

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
        calendar = measure_calendar_layout()
        return BenchmarkResult(
            cold_open,
            search_elapsed,
            agenda_elapsed,
            cache_elapsed,
            len(search),
            len(agenda),
            len(snapshot.tasks),
            len(snapshot.events),
            calendar.week_seconds,
            calendar.month_seconds,
            calendar.week_blocks,
            calendar.month_blocks,
        )
    finally:
        storage.close()


@dataclass(frozen=True, slots=True)
class CalendarLayoutResult:
    """Pure calendar-layout work measured without terminal repaint variance."""

    week_seconds: float
    month_seconds: float
    week_blocks: int
    month_blocks: int


def measure_calendar_layout(
    *, event_count: int = 5_000, task_count: int = 5_000
) -> CalendarLayoutResult:
    """Measure Day/Week/Month geometry with 10,000 calendar-visible records.

    The fixture spreads due tasks and timed events over a complete six-week
    Month while retaining overlapping timed events. It exercises normalisation,
    all-day lane allocation, and timed collision packing without depending on
    a terminal emulator's paint speed.
    """
    origin = date(2026, 8, 3)
    zone = ZoneInfo("UTC")
    events = tuple(
        Event(
            f"calendar-event-{index}",
            "benchmark",
            "primary",
            f"Calendar fixture event {index}",
            EventDateTime(
                DateTimeKind.DATETIME,
                datetime.combine(origin + timedelta(days=index % 42), datetime.min.time(), UTC)
                + timedelta(minutes=(index * 30) % (24 * 60)),
                "UTC",
            ),
            EventDateTime(
                DateTimeKind.DATETIME,
                datetime.combine(origin + timedelta(days=index % 42), datetime.min.time(), UTC)
                + timedelta(minutes=(index * 30) % (24 * 60) + 45),
                "UTC",
            ),
        )
        for index in range(event_count)
    )
    tasks = tuple(
        Task(
            f"calendar-task-{index}",
            "benchmark",
            "inbox",
            f"Calendar fixture task {index}",
            due=origin + timedelta(days=index % 42),
        )
        for index in range(task_count)
    )

    def layout(surface: str) -> tuple[int, int]:
        visible = calendar_range(surface, date(2026, 8, 24), 0)  # type: ignore[arg-type]
        items = calendar_items(
            events,
            tasks,
            visible=visible,
            zone=zone,
            calendar_colors={"primary": "#4285f4"},
            fallback_color="#fbbc04",
        )
        return len(all_day_blocks(items, visible)), len(timed_blocks(items, visible))

    started = perf_counter()
    week_all_day, week_timed = layout("Week")
    week_seconds = perf_counter() - started
    started = perf_counter()
    month_all_day, month_timed = layout("Month")
    month_seconds = perf_counter() - started
    return CalendarLayoutResult(
        week_seconds,
        month_seconds,
        week_all_day + week_timed,
        month_all_day + month_timed,
    )
