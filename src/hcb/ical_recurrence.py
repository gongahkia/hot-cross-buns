"""RFC 5545 recurrence-set helpers used when splitting event series.

Google Calendar stores recurrence content lines rather than materialised local
rules.  Splitting a series still needs to account for the full recurrence set:
``RRULE`` and ``RDATE`` add starts, while ``EXDATE`` and ``EXRULE`` remove
them.  ``python-dateutil`` implements the RFC rule grammar; this module keeps
the small amount of line-preserving split logic at HCB's provider boundary.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrule, rruleset, rrulestr


def split_recurrence_lines(
    recurrence: tuple[str, ...], anchor_value: date | datetime, split_value: date | datetime
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Partition an RFC 5545 recurrence set at a concrete occurrence start.

    The returned lines are suitable for an old series ending just before
    ``split_value`` and a replacement series beginning at ``split_value``.
    Every supported RFC rule parameter remains untouched except its terminal
    ``COUNT``/``UNTIL`` bound.  Explicit RDATE/EXDATE entries are partitioned
    so they remain attached only to the side where they can affect the set.
    """
    anchor = _as_datetime(anchor_value)
    split = _coerce_split(split_value, anchor)
    _recurrence_set(recurrence, anchor)
    old: list[str] = []
    new: list[str] = []
    found_rule = False
    for line in recurrence:
        if line.startswith("RRULE:"):
            found_rule = True
            old.append(
                _rule_with_until(line, _until_before(split, isinstance(anchor_value, datetime)))
            )
            if replacement := _replacement_rule(line, anchor, split):
                new.append(replacement)
            continue
        if line.startswith(("RDATE", "EXDATE")):
            before, after = _partition_date_line(line, split, anchor)
            if before is not None:
                old.append(before)
            if after is not None:
                new.append(after)
            continue
        # EXRULE has no standalone DTSTART. It inherits the master DTSTART;
        # retaining it on both sides preserves provider-native exclusions and
        # lets Google expand any non-editor recurrence grammar it supports.
        old.append(line)
        new.append(line)
    if not found_rule:
        raise ValueError("the recurring series has no RRULE")
    return tuple(old), tuple(new)


def _recurrence_set(recurrence: tuple[str, ...], anchor: datetime) -> rruleset:
    """Parse one RFC recurrence set, including timezone-qualified exception lines."""
    result = rruleset(cache=True)
    for line in recurrence:
        if line.startswith("RRULE:"):
            result.rrule(_parse_rule(line, anchor))
        elif line.startswith("EXRULE:"):
            result.exrule(_parse_rule(f"RRULE:{line.removeprefix('EXRULE:')}", anchor))
        elif line.startswith(("RDATE", "EXDATE")):
            prefix = "RDATE" if line.startswith("RDATE") else "EXDATE"
            _header, values = _date_line_values(line, anchor)
            for _token, value in values:
                (result.rdate if prefix == "RDATE" else result.exdate)(value)
        else:
            raise ValueError(f"unsupported recurrence content line {line.split(':', 1)[0]!r}")
    return result


def _parse_rule(line: str, anchor: datetime) -> rrule:
    try:
        parsed = rrulestr(line, dtstart=anchor, forceset=False, cache=True)
        if not isinstance(parsed, rrule):
            raise ValueError("the recurring series has an invalid RRULE")
        return parsed
    except (TypeError, ValueError) as exc:
        raise ValueError("the recurring series has an invalid RRULE") from exc


def _replacement_rule(line: str, anchor: datetime, split: datetime) -> str | None:
    """Retain a rule's remaining candidate count after a split occurrence."""
    prefix, clauses = _rule_parts(line)
    count = _rule_count(clauses)
    unbounded = [clause for clause in clauses if not clause.startswith(("COUNT=", "UNTIL="))]
    if count is None:
        return f"{prefix}:{';'.join(unbounded)}"
    candidates = _parse_rule(line, anchor).between(anchor, split, inc=True)
    preceding = len(candidates)
    if preceding > count:
        raise ValueError("the selected occurrence is outside the recurring series")
    remaining = count - preceding + 1
    return f"{prefix}:{';'.join((*unbounded, f'COUNT={remaining}'))}" if remaining else None


def _rule_with_until(line: str, until: str) -> str:
    prefix, clauses = _rule_parts(line)
    unbounded = [clause for clause in clauses if not clause.startswith(("COUNT=", "UNTIL="))]
    return f"{prefix}:{';'.join((*unbounded, f'UNTIL={until}'))}"


def _rule_parts(line: str) -> tuple[str, list[str]]:
    prefix, separator, body = line.partition(":")
    clauses = body.split(";") if separator else []
    if (
        prefix != "RRULE"
        or not clauses
        or any(not clause or "=" not in clause for clause in clauses)
    ):
        raise ValueError("the recurring series has an invalid RRULE")
    return prefix, clauses


def _rule_count(clauses: list[str]) -> int | None:
    counts = [clause.partition("=")[2] for clause in clauses if clause.startswith("COUNT=")]
    if not counts:
        return None
    if len(counts) != 1:
        raise ValueError("the recurring series has an invalid COUNT")
    try:
        count = int(counts[0])
    except ValueError as exc:
        raise ValueError("the recurring series has an invalid COUNT") from exc
    if count < 1:
        raise ValueError("the recurring series has an invalid COUNT")
    return count


def _partition_date_line(
    line: str, split: datetime, anchor: datetime
) -> tuple[str | None, str | None]:
    header, values = _date_line_values(line, anchor)
    before = [token for token, value in values if value < split]
    after = [token for token, value in values if value >= split]
    return (
        f"{header}:{','.join(before)}" if before else None,
        f"{header}:{','.join(after)}" if after else None,
    )


def _date_line_values(line: str, anchor: datetime) -> tuple[str, tuple[tuple[str, datetime], ...]]:
    header, separator, raw_values = line.partition(":")
    if not separator or not raw_values:
        raise ValueError("the recurring series has an invalid recurrence date line")
    kind, parameters = _content_line_parameters(header)
    if kind not in {"RDATE", "EXDATE"}:
        raise ValueError("the recurring series has an invalid recurrence date line")
    result: list[tuple[str, datetime]] = []
    for token in raw_values.split(","):
        if not token:
            raise ValueError("the recurring series has an invalid recurrence date line")
        result.append((token, _parse_ical_value(token.split("/", 1)[0], parameters, anchor)))
    return header, tuple(result)


def _content_line_parameters(header: str) -> tuple[str, dict[str, str]]:
    parts = header.split(";")
    kind = parts[0]
    parameters: dict[str, str] = {}
    for part in parts[1:]:
        key, separator, value = part.partition("=")
        if not separator or not key or not value or key.upper() in parameters:
            raise ValueError("the recurring series has an invalid recurrence date line")
        parameters[key.upper()] = value
    return kind, parameters


def _parse_ical_value(value: str, parameters: dict[str, str], anchor: datetime) -> datetime:
    value_kind = parameters.get("VALUE")
    if re.fullmatch(r"\d{8}", value):
        if value_kind not in {None, "DATE"}:
            raise ValueError("the recurring series has an invalid recurrence date line")
        parsed_date = datetime.strptime(value, "%Y%m%d").date()
        return datetime.combine(parsed_date, time.min, tzinfo=anchor.tzinfo)
    if value_kind == "DATE":
        raise ValueError("the recurring series has an invalid recurrence date line")
    match = re.fullmatch(r"(\d{8}T\d{6})(Z)?", value)
    if match is None:
        raise ValueError("the recurring series has an invalid recurrence date line")
    parsed = datetime.strptime(match.group(1), "%Y%m%dT%H%M%S")
    if match.group(2):
        parsed = parsed.replace(tzinfo=UTC)
    elif time_zone := parameters.get("TZID"):
        try:
            parsed = parsed.replace(tzinfo=ZoneInfo(time_zone))
        except ZoneInfoNotFoundError as exc:
            raise ValueError(
                f"the recurring series uses an unknown timezone {time_zone!r}"
            ) from exc
    else:
        parsed = parsed.replace(tzinfo=anchor.tzinfo)
    return _coerce_split(parsed, anchor)


def _as_datetime(value: date | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.combine(value, time.min)


def _coerce_split(value: date | datetime, anchor: datetime) -> datetime:
    parsed = _as_datetime(value)
    if anchor.tzinfo is None:
        return parsed.replace(tzinfo=None)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=anchor.tzinfo)
    return parsed.astimezone(anchor.tzinfo)


def _until_before(split: datetime, timed: bool) -> str:
    if timed:
        return (split.astimezone(UTC) - timedelta(seconds=1)).strftime("%Y%m%dT%H%M%SZ")
    return (split.date() - timedelta(days=1)).strftime("%Y%m%d")
