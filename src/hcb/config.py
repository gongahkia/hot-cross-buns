"""Validated TOML configuration with semantic presentation settings."""

from __future__ import annotations

import tomllib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .models import Preferences
from .paths import AppPaths


class ConfigError(ValueError):
    """Raised when configuration cannot be parsed or validated."""


@dataclass(frozen=True, slots=True)
class Theme:
    name: str = "system"
    accent: str = "blue"
    success: str = "green"
    warning: str = "yellow"
    danger: str = "red"
    muted: str = "gray"


@dataclass(frozen=True, slots=True)
class KeyBindings:
    quit: str = "q"
    help: str = "?"
    search: str = "/"
    sync: str = "r"
    create: str = "n"
    edit: str = "e"
    delete: str = "d"
    complete: str = "space"


@dataclass(frozen=True, slots=True)
class Config:
    preferences: Preferences = field(default_factory=Preferences)
    theme: Theme = field(default_factory=Theme)
    keys: KeyBindings = field(default_factory=KeyBindings)


def _section(data: dict[str, Any], name: str) -> dict[str, Any]:
    value = data.get(name, {})
    if not isinstance(value, dict):
        raise ConfigError(f"[{name}] must be a table")
    return value


def _construct(cls: type[Any], values: dict[str, Any], section: str) -> Any:
    fields = cls.__dataclass_fields__
    unknown = values.keys() - fields.keys()
    if unknown:
        raise ConfigError(f"unknown {section} setting(s): {', '.join(sorted(unknown))}")
    try:
        result = cls(**values)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"invalid [{section}] configuration: {exc}") from exc
    for name, definition in fields.items():
        value = getattr(result, name)
        expected = definition.type
        if expected in ("str", str) and not isinstance(value, str):
            raise ConfigError(f"{section}.{name} must be a string")
        if expected in ("bool", bool) and not isinstance(value, bool):
            raise ConfigError(f"{section}.{name} must be a boolean")
        if expected in ("int", int) and (not isinstance(value, int) or isinstance(value, bool)):
            raise ConfigError(f"{section}.{name} must be an integer")
    return result


def loads(raw: bytes | str) -> Config:
    try:
        data = tomllib.loads(raw.decode() if isinstance(raw, bytes) else raw)
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        raise ConfigError(f"invalid TOML: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError("configuration root must be a table")
    unknown = data.keys() - {"preferences", "theme", "keys"}
    if unknown:
        raise ConfigError(f"unknown configuration section(s): {', '.join(sorted(unknown))}")
    return Config(
        preferences=_construct(Preferences, _section(data, "preferences"), "preferences"),
        theme=_construct(Theme, _section(data, "theme"), "theme"),
        keys=_construct(KeyBindings, _section(data, "keys"), "keys"),
    )


def load(path: Path | None = None) -> Config:
    target = path or AppPaths.discover().config_file
    if not target.exists():
        return Config()
    try:
        return loads(target.read_bytes())
    except OSError as exc:
        raise ConfigError(f"cannot read {target}: {exc}") from exc


def _toml_value(value: Any) -> str:
    if value is None:
        raise TypeError("TOML has no null value")
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, int):
        return str(value)
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def save(config: Config, path: Path | None = None) -> Path:
    target = path or AppPaths.discover().config_file
    target.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for section in ("preferences", "theme", "keys"):
        lines.append(f"[{section}]")
        for key, value in asdict(getattr(config, section)).items():
            if value is not None:
                lines.append(f"{key} = {_toml_value(value)}")
        lines.append("")
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text("\n".join(lines), encoding="utf-8")
    temporary.replace(target)
    return target
