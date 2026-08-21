from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date
from enum import Enum

from hcb.output import to_primitive, write_json, write_tsv


class State(Enum):
    OPEN = "open"


@dataclass(frozen=True)
class Item:
    title: str
    state: State
    day: date


def test_to_primitive_serializes_domain_values() -> None:
    assert to_primitive(Item("Plan", State.OPEN, date(2026, 8, 21))) == {
        "title": "Plan",
        "state": "open",
        "day": "2026-08-21",
    }


def test_json_is_deterministic_and_unicode_safe() -> None:
    output = io.StringIO()
    write_json({"title": "Café", "count": 2}, output)
    assert output.getvalue() == '{\n  "count": 2,\n  "title": "Café"\n}\n'


def test_tsv_removes_embedded_record_separators() -> None:
    output = io.StringIO()
    write_tsv([{"title": "One\nTwo", "notes": "a\tb"}], ["title", "notes"], output)
    assert output.getvalue() == "title\tnotes\nOne Two\ta b\n"
