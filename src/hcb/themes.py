"""Bundled Ghostty-derived visual presets and strict custom-theme loading."""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from functools import cache
from importlib.resources import files
from pathlib import Path
from typing import Any

from .config import ConfigError, Theme, ThemeColors, loads_theme

PRESET_RESOURCE = "hcb-theme-presets-v1.json"
BUNDLED_PRESET_COUNT = 50


@dataclass(frozen=True, slots=True)
class ThemePreset:
    rank: int
    name: str
    upstream_name: str
    family: str
    profile: str
    colors: ThemeColors


def _document() -> dict[str, Any]:
    try:
        document = json.loads(files("hcb.schemas").joinpath(PRESET_RESOURCE).read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid bundled theme presets: {exc}") from exc
    if not isinstance(document, dict):
        raise RuntimeError("bundled theme presets must be an object")
    if document.get("schema_version") != 1:
        raise RuntimeError("unsupported bundled theme preset schema version")
    return document


@cache
def presets() -> tuple[ThemePreset, ...]:
    document = _document()
    entries = document.get("presets")
    if not isinstance(entries, list):
        raise RuntimeError("bundled theme presets must contain a presets array")
    result: list[ThemePreset] = []
    color_fields = set(ThemeColors.__dataclass_fields__)
    for entry in entries:
        if not isinstance(entry, dict):
            raise RuntimeError("bundled theme preset must be an object")
        colors = entry.get("colors")
        if not isinstance(colors, dict) or set(colors) != color_fields:
            raise RuntimeError("bundled theme preset must define every semantic color token")
        if not all(isinstance(value, str) for value in colors.values()):
            raise RuntimeError("bundled theme preset color values must be strings")
        try:
            result.append(
                ThemePreset(
                    rank=entry["rank"],
                    name=entry["name"],
                    upstream_name=entry["upstream_name"],
                    family=entry["family"],
                    profile=entry["profile"],
                    colors=ThemeColors(**colors),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError(f"invalid bundled theme preset: {exc}") from exc
    ordered = tuple(sorted(result, key=lambda preset: preset.rank))
    if len(ordered) != BUNDLED_PRESET_COUNT or [preset.rank for preset in ordered] != list(
        range(1, BUNDLED_PRESET_COUNT + 1)
    ):
        raise RuntimeError(
            f"bundled theme presets must contain ranks 1 through {BUNDLED_PRESET_COUNT}"
        )
    if len({preset.name.casefold() for preset in ordered}) != len(ordered):
        raise RuntimeError("bundled theme preset names must be unique")
    return ordered


def source() -> dict[str, Any]:
    """Return provenance for the pinned Ghostty upstream snapshot."""
    value = _document().get("source")
    if not isinstance(value, dict):
        raise RuntimeError("bundled theme presets must include source metadata")
    return value


def preset(name: str) -> ThemePreset:
    key = name.casefold()
    for item in presets():
        if item.name.casefold() == key:
            return item
    available = ", ".join(item.name for item in presets())
    raise ValueError(f"unknown theme {name!r}; run `hcb themes list` (available: {available})")


def apply_preset(theme: Theme, name: str) -> Theme:
    """Return a complete theme carrying one bundled palette and its visual mode."""
    item = preset(name)
    return replace(theme, profile=item.profile, preset=item.name, colors=item.colors)


def load_custom_theme(path: Path) -> Theme:
    """Load a strict standalone Theme object so users can control every visual token."""
    try:
        return replace(loads_theme(path.read_bytes()), preset=None)
    except OSError as exc:
        raise ConfigError(f"cannot read custom theme {path}: {exc}") from exc
