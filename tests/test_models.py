from datetime import date, datetime, timezone

import pytest

from hcb.models import DateTimeKind, EventDateTime, Preferences


def test_event_datetime_enforces_kind() -> None:
    all_day = EventDateTime(DateTimeKind.DATE, date(2026, 8, 21))
    instant = EventDateTime(
        DateTimeKind.DATETIME, datetime(2026, 8, 21, 9, tzinfo=timezone.utc)
    )
    assert all_day.value == date(2026, 8, 21)
    assert instant.time_zone is None
    with pytest.raises(ValueError):
        EventDateTime(DateTimeKind.DATE, datetime.now(timezone.utc))
    with pytest.raises(ValueError):
        EventDateTime(DateTimeKind.DATETIME, date.today())


def test_preferences_validates_week_start() -> None:
    assert Preferences(week_starts_on=6).week_starts_on == 6
    with pytest.raises(ValueError):
        Preferences(week_starts_on=7)
