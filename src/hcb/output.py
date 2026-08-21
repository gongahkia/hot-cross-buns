"""Terminal and machine-output helpers."""

from __future__ import annotations

import dataclasses
import json
import os
import sys
from datetime import date, datetime
from enum import Enum
from typing import Any, Iterable, Mapping, TextIO


def color_enabled(stream: TextIO = sys.stdout, *, requested: bool | None = None) -> bool:
    if requested is not None:
        return requested
    if os.environ.get("NO_COLOR") is not None or os.environ.get("TERM") == "dumb":
        return False
    return stream.isatty()


def to_primitive(value: Any) -> Any:
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {field.name: to_primitive(getattr(value, field.name)) for field in dataclasses.fields(value)}
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): to_primitive(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [to_primitive(item) for item in value]
    return value


def write_json(value: Any, stream: TextIO = sys.stdout) -> None:
    json.dump(to_primitive(value), stream, ensure_ascii=False, indent=2, sort_keys=True)
    stream.write("\n")


def write_json_lines(values: Iterable[Any], stream: TextIO = sys.stdout) -> None:
    for value in values:
        stream.write(json.dumps(to_primitive(value), ensure_ascii=False, sort_keys=True))
        stream.write("\n")


def write_tsv(
    rows: Iterable[Mapping[str, Any]],
    fields: list[str],
    stream: TextIO = sys.stdout,
    *,
    header: bool = True,
) -> None:
    def clean(value: Any) -> str:
        if value is None:
            return ""
        return str(to_primitive(value)).replace("\t", " ").replace("\r", " ").replace("\n", " ")

    if header:
        stream.write("\t".join(fields) + "\n")
    for row in rows:
        stream.write("\t".join(clean(row.get(field)) for field in fields) + "\n")
