from pathlib import Path

import pytest

from hcb.config import Config, ConfigError, KeyBindings, Theme, load, loads, save
from hcb.models import Preferences


def test_defaults_are_semantic_and_valid() -> None:
    config = loads("")
    assert config.theme.danger == "red"
    assert config.keys.search == "/"
    assert config.preferences.week_starts_on == 0


def test_toml_round_trip(tmp_path: Path) -> None:
    expected = Config(
        Preferences(theme="dark", week_starts_on=6, reminders_enabled=False),
        Theme(name="night", accent="#88c0d0"),
        KeyBindings(sync="ctrl+r"),
    )
    target = tmp_path / "nested" / "config.toml"
    assert save(expected, target) == target
    assert load(target) == expected


@pytest.mark.parametrize(
    "raw",
    (
        "[preferences]\nweek_starts_on = 9",
        "[theme]\nunknown = 'x'",
        "[keys]\nquit = 3",
        "[unknown]\nvalue = true",
    ),
)
def test_invalid_config_is_rejected(raw: str) -> None:
    with pytest.raises(ConfigError):
        loads(raw)
