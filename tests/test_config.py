import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from hcb.config import (
    Config,
    ConfigError,
    KeyBindings,
    Theme,
    ThemeColors,
    load,
    loads,
    save,
    schema,
)
from hcb.loaders import DEFAULT_LOADER, LOADER_NAMES, LOADER_PRESETS
from hcb.models import Preferences
from hcb.paths import AppPaths


def test_defaults_are_terminal_minimal_and_valid(tmp_path: Path) -> None:
    config = load(tmp_path / "missing.json")
    assert config.theme.profile == "terminal"
    assert config.theme.borders == "ascii"
    assert config.theme.colors.background == "transparent"
    assert config.theme.colors.control == "ansi_default"
    assert config.keys.search == "slash,ctrl+p"
    assert config.keys.external_editor == "ctrl+g"
    assert config.preferences.editor == "nvim"
    assert config.preferences.week_starts_on == 0
    assert config.preferences.date_time_format == "friendly"
    assert config.theme.loader == DEFAULT_LOADER


def test_rattles_loader_catalog_is_complete_and_preserves_source_timing() -> None:
    expected = {
        "arrows.arrow",
        "arrows.double_arrow",
        "ascii.dqpb",
        "ascii.rolling_line",
        "ascii.simple_dots",
        "ascii.simple_dots_scrolling",
        "ascii.arc",
        "ascii.balloon",
        "ascii.circle_halves",
        "ascii.circle_quarters",
        "ascii.point",
        "ascii.square_corners",
        "ascii.toggle",
        "ascii.triangle",
        "ascii.grow_horizontal",
        "ascii.grow_vertical",
        "ascii.noise",
        "braille.dots",
        "braille.dots2",
        "braille.dots3",
        "braille.dots4",
        "braille.dots5",
        "braille.dots6",
        "braille.dots7",
        "braille.dots8",
        "braille.dots9",
        "braille.dots10",
        "braille.dots11",
        "braille.dots12",
        "braille.dots13",
        "braille.dots14",
        "braille.sand",
        "braille.bounce",
        "braille.dots_circle",
        "braille.wave",
        "braille.scan",
        "braille.rain",
        "braille.pulse",
        "braille.snake",
        "braille.sparkle",
        "braille.cascade",
        "braille.columns",
        "braille.orbit",
        "braille.breathe",
        "braille.waverows",
        "braille.checkerboard",
        "braille.helix",
        "braille.fillsweep",
        "braille.diagswipe",
        "braille.infinity",
        "emoji.hearts",
        "emoji.clock",
        "emoji.earth",
        "emoji.moon",
        "emoji.speaker",
        "emoji.weather",
    }
    assert set(LOADER_NAMES) == expected
    rolling_line = LOADER_PRESETS["ascii.rolling_line"]
    assert rolling_line.interval_ms == 80
    assert rolling_line.frame_at(0.16) == "\\"


def test_json_round_trip(tmp_path: Path) -> None:
    expected = Config(
        preferences=Preferences(
            theme="dark", editor="hx", week_starts_on=6, reminders_enabled=False
        ),
        theme=Theme(profile="dark", colors=ThemeColors(accent="#88c0d0")),
        keys=KeyBindings(sync="ctrl+r", external_editor="ctrl+g"),
    )
    target = tmp_path / "nested" / "config.json"
    assert save(expected, target) == target
    assert load(target) == expected
    document = json.loads(target.read_text())
    assert document["schema_version"] == 2
    assert document["theme"]["colors"]["accent"] == "#88c0d0"


def test_legacy_toml_is_not_read_or_migrated(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    paths.config_dir.mkdir()
    (paths.config_dir / "config.toml").write_text("[theme]\nname = 'dark'\n")
    assert paths.config_file.name == "config.json"
    assert load(paths.config_file) == Config()


@pytest.mark.parametrize(
    "raw",
    (
        '{"preferences":{"week_starts_on":9}}',
        '{"theme":{"unknown":"x"}}',
        '{"keys":{"quit":3}}',
        '{"unknown":{"value":true}}',
        '{"preferences":{"week_starts_on":"0"}}',
        '{"preferences":{"editor":""}}',
        '{"preferences":{"date_time_format":"clockwork"}}',
        '{"keys":{"external_editor":""}}',
        '{"theme":{"colors":{"accent":"not-a-color"}}}',
        '{"theme":{"loader":"not-a-loader"}}',
        '{"theme":{"colors":{"accent":"red","accent":"blue"}}}',
    ),
)
def test_invalid_strict_json_config_is_rejected(raw: str) -> None:
    with pytest.raises(ConfigError):
        loads(raw)


def test_bundled_schema_accepts_saved_config_and_rejects_unknown_tokens(tmp_path: Path) -> None:
    target = save(Config(theme=Theme(preset="Dracula")), tmp_path / "config.json")
    validator = Draft202012Validator(schema())
    assert list(validator.iter_errors(json.loads(target.read_text()))) == []
    invalid = {"theme": {"colors": {"unexpected": "red"}}}
    assert list(validator.iter_errors(invalid))
