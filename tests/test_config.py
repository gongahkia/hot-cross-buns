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
from hcb.models import Preferences
from hcb.paths import AppPaths


def test_defaults_are_terminal_minimal_and_valid(tmp_path: Path) -> None:
    config = load(tmp_path / "missing.json")
    assert config.theme.profile == "terminal"
    assert config.theme.borders == "ascii"
    assert config.theme.colors.background == "transparent"
    assert config.theme.colors.control == "ansi_default"
    assert config.keys.search == "/"
    assert config.preferences.week_starts_on == 0


def test_json_round_trip(tmp_path: Path) -> None:
    expected = Config(
        preferences=Preferences(theme="dark", week_starts_on=6, reminders_enabled=False),
        theme=Theme(profile="dark", colors=ThemeColors(accent="#88c0d0")),
        keys=KeyBindings(sync="ctrl+r"),
    )
    target = tmp_path / "nested" / "config.json"
    assert save(expected, target) == target
    assert load(target) == expected
    document = json.loads(target.read_text())
    assert document["schema_version"] == 1
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
        '{"theme":{"colors":{"accent":"not-a-color"}}}',
        '{"theme":{"colors":{"accent":"red","accent":"blue"}}}',
    ),
)
def test_invalid_strict_json_config_is_rejected(raw: str) -> None:
    with pytest.raises(ConfigError):
        loads(raw)


def test_bundled_schema_accepts_saved_config_and_rejects_unknown_tokens(tmp_path: Path) -> None:
    target = save(Config(), tmp_path / "config.json")
    validator = Draft202012Validator(schema())
    assert list(validator.iter_errors(json.loads(target.read_text()))) == []
    invalid = {"theme": {"colors": {"unexpected": "red"}}}
    assert list(validator.iter_errors(invalid))
