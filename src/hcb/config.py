"""Validated strict JSON configuration and semantic terminal presentation settings."""

from __future__ import annotations

import json
import re
from collections.abc import Collection
from dataclasses import asdict, dataclass, field
from importlib.resources import files
from pathlib import Path
from types import UnionType
from typing import Any, Union, cast, get_args, get_origin, get_type_hints

from rich.errors import StyleSyntaxError
from rich.style import Style
from textual.color import Color, ColorParseError
from textual.keys import KEY_NAME_REPLACEMENTS, Keys, key_to_character

from .loaders import DEFAULT_LOADER, LOADER_PRESETS
from .models import CapturePreferences, Preferences
from .paths import AppPaths

CONFIG_SCHEMA_VERSION = 2
CONFIG_SCHEMA_RESOURCE = "hcb-config-v2.schema.json"


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
class RoleStyle:
    """Optional presentation override for a named HCB interface role."""

    color: str | None = None
    background: str | None = None
    text_style: str = "none"

    def __post_init__(self) -> None:
        for name in ("color", "background"):
            value = getattr(self, name)
            if value is None:
                continue
            try:
                Color.parse(value)
            except ColorParseError as exc:
                raise ValueError(f"theme.roles.{name} must be a valid color") from exc
        if not self.text_style.strip():
            raise ValueError("theme role text_style must not be empty")
        try:
            Style.parse(self.text_style)
        except StyleSyntaxError as exc:
            raise ValueError("theme role text_style must be valid Rich style syntax") from exc


@dataclass(frozen=True, slots=True)
class ThemeRoles:
    completed_item: RoleStyle = field(
        default_factory=lambda: RoleStyle(color="ansi_default", text_style="dim strike")
    )
    selected_item: RoleStyle = field(
        default_factory=lambda: RoleStyle(color="ansi_default", text_style="bold reverse")
    )
    link: RoleStyle = field(
        default_factory=lambda: RoleStyle(color="ansi_default", text_style="underline")
    )
    modal_title: RoleStyle = field(
        default_factory=lambda: RoleStyle(color="ansi_default", text_style="bold")
    )


@dataclass(frozen=True, slots=True)
class Theme:
    profile: str = "terminal"
    preset: str | None = None
    density: str = "comfortable"
    borders: str = "ascii"
    focus: str = "ascii"
    mouse: bool = True
    loader: str = DEFAULT_LOADER
    colors: ThemeColors = field(default_factory=ThemeColors)
    roles: ThemeRoles = field(default_factory=ThemeRoles)
    stylesheet: str | None = None

    def __post_init__(self) -> None:
        if self.profile not in {"terminal", "dark", "light"}:
            raise ValueError("theme.profile must be terminal, dark, or light")
        if self.preset is not None and not self.preset.strip():
            raise ValueError("theme.preset cannot be empty")
        if self.density not in {"compact", "comfortable"}:
            raise ValueError("theme.density must be compact or comfortable")
        if self.borders not in {"unicode", "ascii"}:
            raise ValueError("theme.borders must be unicode or ascii")
        if self.focus not in {"ascii", "underline", "reverse"}:
            raise ValueError("theme.focus must be ascii, underline, or reverse")
        if self.loader not in LOADER_PRESETS:
            raise ValueError("theme.loader must name a bundled Rattles loader")
        if self.stylesheet is not None and not self.stylesheet.strip():
            raise ValueError("theme.stylesheet cannot be empty")


@dataclass(frozen=True, slots=True)
class KeyBindings:
    quit: str = "q"
    help: str = "question_mark"
    search: str = "slash,ctrl+p"
    sync: str = "r"
    create: str = "n"
    edit: str = "e"
    delete: str = "d"
    complete: str = "space"
    jump: str = "g"
    mark: str = "x"
    rsvp: str = "v"
    undo: str = "u"
    redo: str = "ctrl+r"
    tasks: str = "1"
    notes: str = "2"
    agenda: str = "3"
    day: str = "4"
    week: str = "5"
    month: str = "6"
    resize_sidebar_narrower: str = "ctrl+alt+left"
    resize_sidebar_wider: str = "ctrl+alt+right"
    external_editor: str = "ctrl+g"
    modal_edit: str = "e"
    modal_delete: str = "d"
    modal_confirm: str = "y"
    modal_cancel: str = "n"

    def __post_init__(self) -> None:
        bindings = asdict(self)
        for name, value in bindings.items():
            self._validate_binding(name, value)
        self._validate_scope(
            "global", bindings, set(bindings) - self._modal_keys - {"external_editor"}
        )
        self._validate_scope("modal", bindings, self._modal_keys)

    _modal_keys = frozenset({"modal_edit", "modal_delete", "modal_confirm", "modal_cancel"})
    _modifiers = frozenset({"ctrl", "alt", "shift", "meta", "super", "command"})
    _named_keys = frozenset({*(key.value for key in Keys), *KEY_NAME_REPLACEMENTS.values()})

    @classmethod
    def _validate_binding(cls, name: str, value: object) -> None:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"keys.{name} must not be empty")
        for key in value.split(","):
            key = key.strip()
            if not key:
                raise ValueError(f"keys.{name} cannot include an empty shortcut")
            parts = key.split("+")
            modifiers, actual = parts[:-1], parts[-1]
            if (
                not actual
                or len(set(modifiers)) != len(modifiers)
                or any(modifier not in cls._modifiers for modifier in modifiers)
            ):
                raise ValueError(f"keys.{name} has invalid shortcut {key!r}")
            if (
                len(actual) != 1
                and actual not in cls._named_keys
                and key_to_character(actual) is None
            ):
                raise ValueError(f"keys.{name} has unknown key {actual!r}")

    @classmethod
    def _validate_scope(cls, scope: str, bindings: dict[str, str], names: Collection[str]) -> None:
        seen: dict[str, str] = {}
        for name in names:
            for key in bindings[name].split(","):
                normalized = key.strip()
                if previous := seen.get(normalized):
                    raise ValueError(
                        f"keys.{name} conflicts with keys.{previous} in the {scope} scope"
                    )
                seen[normalized] = name


@dataclass(frozen=True, slots=True)
class TuiSettings:
    initial_surface: str = "Tasks"
    sidebar_visible: bool = True
    sidebar_width: int = 27
    agenda_days: int = 14
    task_show_due: bool = True
    notes_show_preview: bool = True
    agenda_show_calendar: bool = False
    agenda_show_location: bool = False

    def __post_init__(self) -> None:
        if self.initial_surface not in {"Tasks", "Notes", "Agenda", "Day", "Week", "Month"}:
            raise ValueError("tui.initial_surface must name a supported surface")
        if not 22 <= self.sidebar_width <= 60:
            raise ValueError("tui.sidebar_width must be between 22 and 60")
        if not 1 <= self.agenda_days <= 31:
            raise ValueError("tui.agenda_days must be between 1 and 31")


@dataclass(frozen=True, slots=True)
class Config:
    schema_version: int = CONFIG_SCHEMA_VERSION
    preferences: Preferences = field(default_factory=Preferences)
    theme: Theme = field(default_factory=Theme)
    keys: KeyBindings = field(default_factory=KeyBindings)
    tui: TuiSettings = field(default_factory=TuiSettings)
    active_profile: str | None = None

    def __post_init__(self) -> None:
        if self.schema_version != CONFIG_SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {CONFIG_SCHEMA_VERSION}")
        if self.active_profile is not None and not self.active_profile.strip():
            raise ValueError("active_profile cannot be empty")
        if self.active_profile is not None and not re.fullmatch(
            r"[a-z0-9][a-z0-9_-]*", self.active_profile
        ):
            raise ValueError("active_profile must be a valid profile name")


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
    if origin is tuple:
        if not isinstance(value, tuple):
            return False
        members = get_args(expected)
        return not members or all(_matches_type(item, members[0]) for item in value)
    return isinstance(value, expected)


def _type_label(expected: Any) -> str:
    origin = get_origin(expected)
    if origin in {Union, UnionType}:
        return " or ".join(_type_label(member) for member in get_args(expected))
    if expected is type(None):
        return "null"
    return str(getattr(expected, "__name__", expected))


def _json_object(raw: bytes | str) -> dict[str, Any]:
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
    return data


def _theme(values: dict[str, Any]) -> Theme:
    theme_values = dict(values)
    colors = values.get("colors", {})
    if not isinstance(colors, dict):
        raise ConfigError("theme.colors must be an object")
    theme_values["colors"] = _construct(ThemeColors, colors, "theme.colors")
    roles = values.get("roles", {})
    if not isinstance(roles, dict):
        raise ConfigError("theme.roles must be an object")
    role_values: dict[str, RoleStyle] = {}
    for name, value in roles.items():
        if not isinstance(value, dict):
            raise ConfigError(f"theme.roles.{name} must be an object")
        role_values[name] = _construct(RoleStyle, value, f"theme.roles.{name}")
    theme_values["roles"] = _construct(ThemeRoles, role_values, "theme.roles")
    return cast(Theme, _construct(Theme, theme_values, "theme"))


def _preferences(values: dict[str, Any], *, migrate_v1: bool = False) -> Preferences:
    preference_values = dict(values)
    if migrate_v1:
        preference_values.pop("theme", None)
        preference_values.pop("keymap", None)
    capture = values.get("capture", {})
    if not isinstance(capture, dict):
        raise ConfigError("preferences.capture must be an object")
    capture_values = dict(capture)
    for name in (
        "task_aliases",
        "event_aliases",
        "high_priority_aliases",
        "medium_priority_aliases",
        "low_priority_aliases",
    ):
        if name in capture_values:
            value = capture_values[name]
            if not isinstance(value, list) or not all(
                isinstance(item, str) and item.strip() for item in value
            ):
                raise ConfigError(f"preferences.capture.{name} must be an array of strings")
            capture_values[name] = tuple(value)
    if "default_event_duration_minutes" in capture_values:
        duration = capture_values["default_event_duration_minutes"]
        if not isinstance(duration, int) or isinstance(duration, bool) or not 1 <= duration <= 1440:
            raise ConfigError(
                "preferences.capture.default_event_duration_minutes must be between 1 and 1440"
            )
    preference_values["capture"] = _construct(
        CapturePreferences, capture_values, "preferences.capture"
    )
    return cast(Preferences, _construct(Preferences, preference_values, "preferences"))


def loads(raw: bytes | str) -> Config:
    data = _json_object(raw)
    unknown = data.keys() - {
        "schema_version",
        "preferences",
        "theme",
        "keys",
        "tui",
        "active_profile",
    }
    if unknown:
        raise ConfigError(f"unknown configuration section(s): {', '.join(sorted(unknown))}")
    schema_version = data.get("schema_version", 1)
    if not isinstance(schema_version, int) or isinstance(schema_version, bool):
        raise ConfigError("schema_version must be an integer")
    if schema_version not in {1, CONFIG_SCHEMA_VERSION}:
        raise ConfigError(f"schema_version must be 1 or {CONFIG_SCHEMA_VERSION}")
    try:
        return Config(
            schema_version=CONFIG_SCHEMA_VERSION,
            preferences=_preferences(_section(data, "preferences"), migrate_v1=schema_version == 1),
            theme=_theme(_section(data, "theme")),
            keys=_construct(KeyBindings, _section(data, "keys"), "keys"),
            tui=_construct(TuiSettings, _section(data, "tui"), "tui"),
            active_profile=data.get("active_profile"),
        )
    except ValueError as exc:
        raise ConfigError(f"invalid configuration: {exc}") from exc


def loads_theme(raw: bytes | str) -> Theme:
    """Parse a strict standalone visual-theme JSON object."""
    return _theme(_json_object(raw))


_PROFILE_NAME = re.compile(r"[a-z0-9][a-z0-9_-]*")


def profile_path(config_path: Path, name: str) -> Path:
    """Return the strict per-user overlay file for a safe profile name."""
    if not _PROFILE_NAME.fullmatch(name):
        raise ConfigError(
            "profile names must use lowercase letters, digits, underscores, or hyphens"
        )
    return config_path.parent / "profiles" / f"{name}.json"


def _merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(cast(dict[str, Any], result[key]), value)
        else:
            result[key] = value
    return result


def load(
    path: Path | None = None, *, profile: str | None = None, resolve_profile: bool = True
) -> Config:
    target = path or AppPaths.discover().config_file
    if not target.exists():
        base = Config()
    else:
        try:
            base = loads(target.read_bytes())
        except OSError as exc:
            raise ConfigError(f"cannot read {target}: {exc}") from exc
    selected = (
        profile if profile is not None else (base.active_profile if resolve_profile else None)
    )
    if selected is None:
        return base
    source = profile_path(target, selected)
    try:
        overlay = _json_object(source.read_bytes())
    except OSError as exc:
        raise ConfigError(f"cannot read profile {source}: {exc}") from exc
    forbidden = {"schema_version", "active_profile"} & overlay.keys()
    if forbidden:
        raise ConfigError(f"profile cannot define: {', '.join(sorted(forbidden))}")
    base_document = asdict(base)
    return loads(json.dumps(_merge(base_document, overlay)))


def save(config: Config, path: Path | None = None) -> Path:
    target = path or AppPaths.discover().config_file
    target.parent.mkdir(parents=True, exist_ok=True)
    config = loads(json.dumps(asdict(config)))
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(
        json.dumps(asdict(config), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(target)
    return target


def _profile_difference(base: object, configured: object) -> object | None:
    if isinstance(base, dict) and isinstance(configured, dict):
        difference = {
            key: changed
            for key, value in configured.items()
            if (changed := _profile_difference(base.get(key), value)) is not None
        }
        return difference or None
    return configured if base != configured else None


def save_profile(config: Config, path: Path, name: str) -> Path:
    """Persist only the resolved differences for one strict profile overlay."""
    target = profile_path(path, name)
    config = loads(json.dumps(asdict(config)))
    base = load(path, resolve_profile=False)
    difference = _profile_difference(asdict(base), asdict(config))
    overlay = cast(dict[str, Any], difference or {})
    overlay.pop("schema_version", None)
    overlay.pop("active_profile", None)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(overlay, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(target)
    return target


def schema() -> dict[str, Any]:
    """Return the bundled Draft 2020-12 schema for ``config.json``."""
    document = json.loads(
        files("hcb.schemas").joinpath(CONFIG_SCHEMA_RESOURCE).read_text(encoding="utf-8")
    )
    if not isinstance(document, dict):
        raise RuntimeError("bundled config schema must be an object")
    return document
