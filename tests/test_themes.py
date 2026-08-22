from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from hcb.config import ConfigError, Theme, ThemeColors
from hcb.themes import apply_preset, load_custom_theme, preset, presets, source


def test_bundled_presets_are_complete_and_pinned_to_ghostty_snapshot() -> None:
    available = presets()

    assert len(available) == 30
    assert [item.rank for item in available] == list(range(1, 31))
    assert available[0].name == "Dracula"
    assert available[0].colors.background == "#282a36"
    assert {item.name.casefold() for item in available} == {
        item.name.casefold() for item in available
    }
    assert all(
        set(asdict(item.colors)) == set(ThemeColors.__dataclass_fields__) for item in available
    )
    assert source()["upstream_commit"] == "4cbae6273354e5e91a7641d72c69daa3de6a867f"
    assert source()["upstream_theme_count"] == 606


def test_applying_a_preset_preserves_user_interface_preferences() -> None:
    original = Theme(density="compact", borders="unicode", focus="reverse", mouse=False)
    applied = apply_preset(original, "Catppuccin Latte")

    assert applied.preset == "Catppuccin Latte"
    assert applied.profile == "light"
    assert applied.density == "compact"
    assert applied.borders == "unicode"
    assert applied.focus == "reverse"
    assert not applied.mouse
    assert applied.colors.background == "#eff1f5"
    assert preset("catppuccin latte").name == "Catppuccin Latte"


def test_custom_theme_file_controls_every_visual_setting_and_is_strict(tmp_path: Path) -> None:
    colors = ThemeColors(**{name: "#123456" for name in ThemeColors.__dataclass_fields__})
    expected = Theme(
        profile="light",
        preset="temporary label",
        density="compact",
        borders="unicode",
        focus="reverse",
        mouse=False,
        colors=colors,
    )
    target = tmp_path / "custom-theme.json"
    target.write_text(json.dumps(asdict(expected)), encoding="utf-8")

    loaded = load_custom_theme(target)
    assert loaded == Theme(
        profile="light",
        density="compact",
        borders="unicode",
        focus="reverse",
        mouse=False,
        colors=colors,
    )

    target.write_text('{"colors":{"accent":"red","unknown":"blue"}}', encoding="utf-8")
    with pytest.raises(ConfigError, match="unknown theme.colors setting"):
        load_custom_theme(target)
