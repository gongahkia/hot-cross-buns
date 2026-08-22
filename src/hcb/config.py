"""Validated strict JSON configuration and semantic terminal presentation settings."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from types import UnionType
from typing import Any, Union, get_args, get_origin, get_type_hints

from textual.color import Color, ColorParseError

from .models import Preferences
from .paths import AppPaths

CONFIG_SCHEMA_VERSION = 1


class ConfigError(ValueError):
    """Raised when configuration cannot be parsed or validated."""


@dataclass(frozen=True, slots=True)
class ThemeColors:
    """Semantic UI tokens, expressed in Textual-compatible color values."""

    background: str = "transparent"
    surface: str = "transparent"
    panel: str = "transparent"
    overlay: str = "transparent"
    control: str = "ansi_default"
    text: str = "ansi_default"
    muted: str = "ansi_default"
    border: str = "ansi_default"
    focus: str = "ansi_default"
    selection: str = "ansi_default"
    accent: str = "ansi_default"
    success: str = "ansi_default"
    warning: str = "ansi_default"
    danger: str = "ansi_default"

    def __post_init__(self) -> None:
        for name, value in asdict(self).items():
            try:
                Color.parse(value)
            except ColorParseError as exc:
                raise ValueError(f"theme.colors.{name} must be a valid color") from exc


@dataclass(frozen=True, slots=True)
class Theme:
    profile: str = "terminal"
    density: str = "comfortable"
    borders: str = "ascii"
    focus: str = "ascii"
    mouse: bool = True
    colors: ThemeColors = field(default_factory=ThemeColors)

    def __post_init__(self) -> None:
        if self.profile not in {"terminal", "dark", "light"}:
            raise ValueError("theme.profile must be terminal, dark, or light")
        if self.density not in {"compact", "comfortable"}:
            raise ValueError("theme.density must be compact or comfortable")
        if self.borders not in {"unicode", "ascii"}:
            raise ValueError("theme.borders must be unicode or ascii")
        if self.focus not in {"ascii", "underline", "reverse"}:
            raise ValueError("theme.focus must be ascii, underline, or reverse")


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
    schema_version: int = CONFIG_SCHEMA_VERSION
    preferences: Preferences = field(default_factory=Preferences)
    theme: Theme = field(default_factory=Theme)
    keys: KeyBindings = field(default_factory=KeyBindings)

    def __post_init__(self) -> None:
        if self.schema_version != CONFIG_SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {CONFIG_SCHEMA_VERSION}")


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ConfigError(f"duplicate configuration key {key!r}")
        result[key] = value
    return result


def _section(data: dict[str, Any], name: str) -> dict[str, Any]:
    value = data.get(name, {})
    if not isinstance(value, dict):
        raise ConfigError(f"{name} must be an object")
    return value


def _construct(cls: type[Any], values: dict[str, Any], section: str) -> Any:
    fields = cls.__dataclass_fields__
    unknown = values.keys() - fields.keys()
    if unknown:
        raise ConfigError(f"unknown {section} setting(s): {', '.join(sorted(unknown))}")
    try:
        result = cls(**values)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"invalid {section} configuration: {exc}") from exc
    for name, expected in get_type_hints(cls).items():
        value = getattr(result, name)
        if not _matches_type(value, expected):
            raise ConfigError(f"{section}.{name} must be {_type_label(expected)}")
    return result


def _matches_type(value: Any, expected: Any) -> bool:
    origin = get_origin(expected)
    if origin in {Union, UnionType}:
        return any(_matches_type(value, member) for member in get_args(expected))
    if expected is int:
        return isinstance(value, int) and not isinstance(value, bool)
    if expected is type(None):
        return value is None
    if expected in {str, bool}:
        return isinstance(value, expected)
    return isinstance(value, expected)


def _type_label(expected: Any) -> str:
    origin = get_origin(expected)
    if origin in {Union, UnionType}:
        return " or ".join(_type_label(member) for member in get_args(expected))
    if expected is type(None):
        return "null"
    return str(getattr(expected, "__name__", expected))


def loads(raw: bytes | str) -> Config:
    try:
        data = json.loads(
            raw.decode("utf-8") if isinstance(raw, bytes) else raw,
            object_pairs_hook=_object_without_duplicates,
        )
    except UnicodeDecodeError as exc:
        raise ConfigError(f"invalid JSON encoding: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError("configuration root must be an object")
    unknown = data.keys() - {"schema_version", "preferences", "theme", "keys"}
    if unknown:
        raise ConfigError(f"unknown configuration section(s): {', '.join(sorted(unknown))}")
    schema_version = data.get("schema_version", CONFIG_SCHEMA_VERSION)
    if not isinstance(schema_version, int) or isinstance(schema_version, bool):
        raise ConfigError("schema_version must be an integer")
    theme_data = _section(data, "theme")
    theme_values = dict(theme_data)
    colors = theme_data.get("colors", {})
    if not isinstance(colors, dict):
        raise ConfigError("theme.colors must be an object")
    theme_values["colors"] = _construct(ThemeColors, colors, "theme.colors")
    return Config(
        schema_version=schema_version,
        preferences=_construct(Preferences, _section(data, "preferences"), "preferences"),
        theme=_construct(Theme, theme_values, "theme"),
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


def save(config: Config, path: Path | None = None) -> Path:
    target = path or AppPaths.discover().config_file
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(
        json.dumps(asdict(config), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(target)
    return target
