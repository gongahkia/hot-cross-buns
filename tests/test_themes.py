from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import pytest
from textual.color import Color

from hcb.config import ConfigError, Theme, ThemeColors
from hcb.themes import (
    BUNDLED_PRESET_COUNT,
    apply_preset,
    load_custom_theme,
    preset,
    presets,
    source,
)
from hcb.tui_theme import build_textual_theme


def test_bundled_presets_are_complete_and_pinned_to_ghostty_snapshot() -> None:
    available = presets()

    assert len(available) == BUNDLED_PRESET_COUNT == 100
    assert [item.rank for item in available] == list(range(1, 101))
    assert available[0].name == "Dracula"
    assert available[0].colors.background == "#282a36"
    assert {item.name.casefold() for item in available} == {
        item.name.casefold() for item in available
    }
    assert all(
        set(asdict(item.colors)) == set(ThemeColors.__dataclass_fields__) for item in available
    )
    assert source()["upstream_commit"] == "75c93eebaca34a6194ba8bdb83d99b62e20f9aba"
    assert source()["upstream_theme_count"] == 606
    assert preset("Flexoki Light").profile == "light"
    assert preset("Oxocarbon").colors.background == "#161616"
    assert preset("Tomorrow Night").colors.background == "#1d1f21"
    assert preset("Synthwave").colors.accent == "#2186ec"
    assert preset("Iceberg Dark").colors.selection == "#c6c8d1"
    assert preset("One Half Dark").colors.focus == "#a3b3cc"
    assert preset("Ayu").colors.success == "#7fd962"
    assert preset("Zenburn").colors.warning == "#f0dfaf"
    assert preset("Cobalt2").colors.background == "#132738"
    assert preset("Vesper").colors.danger == "#f5a191"
    assert preset("Horizon").colors.accent == "#26bbd9"
    assert preset("Poimandres").colors.text == "#a6accd"
    assert preset("Everblush").colors.background == "#141b1e"
    assert preset("Moonfly").colors.selection == "#b2ceee"
    assert preset("No Clown Fiesta").colors.accent == "#bad7ff"
    assert preset("No Clown Fiesta Light").profile == "light"
    assert preset("Zenbones Dark").colors.focus == "#c4cacf"
    assert preset("Zenbones Light").colors.warning == "#944927"
    assert preset("Modus Vivendi").colors.accent == "#2fafff"
    assert preset("Modus Operandi").profile == "light"
    assert preset("Onenord").colors.background == "#2e3440"
    assert preset("Onenord Light").colors.success == "#48a53d"
    assert preset("Ayu Light").colors.focus == "#ffaa33"
    assert preset("One Half Light").colors.selection == "#bfceff"
    assert preset("Iceberg Light").colors.panel == "#dcdfe7"
    assert preset("Dark+").colors.danger == "#cd3131"
    assert preset("Night Owlish Light").colors.accent == "#4876d6"
    assert preset("Selenized Black").colors.background == "#181818"
    assert preset("Selenized Dark").colors.accent == "#4695f7"
    assert preset("Selenized Light").profile == "light"
    assert preset("Melange Dark").colors.text == "#ece1d7"
    assert preset("Melange Light").colors.warning == "#bc5c00"
    assert preset("Bluloco Dark").colors.focus == "#ffcc00"
    assert preset("Bluloco Light").colors.selection == "#daf0ff"
    assert preset("Oceanic Next").colors.background == "#162c35"
    assert preset("Challenger Deep").colors.success == "#62d196"
    assert preset("Miasma").colors.warning == "#b36d43"
    assert preset("Vague").colors.accent == "#6e94b2"
    assert preset("Kanso Ink").colors.selection == "#22262d"
    assert preset("Kanso Pearl").profile == "light"
    assert preset("Jellybeans").colors.control == "#929292"
    assert preset("Molokai").colors.danger == "#fa2573"
    assert preset("Srcery").colors.text == "#fce8c3"
    assert preset("Spacegray").colors.background == "#20242d"
    assert preset("Spacegray Eighties").colors.warning == "#fec254"
    assert preset("JetBrains Darcula").colors.focus == "#ffffff"
    assert preset("Alabaster").profile == "light"
    assert preset("Fairyfloss").colors.background == "#5a5475"
    assert preset("Firefox Dev").colors.selection == "#163c61"
    assert preset("Seoulbones Dark").colors.accent == "#97bdde"
    assert preset("Seoulbones Light").profile == "light"
    assert preset("Xcode Light").colors.panel == "#b4d8fd"


def test_bundled_presets_expose_every_semantic_color_to_textual() -> None:
    theme_tokens = {
        "background": "background",
        "surface": "surface",
        "panel": "panel",
        "control": "boost",
        "text": "foreground",
        "muted": "text-muted",
        "border": "border",
        "focus": "primary",
        "accent": "accent",
        "success": "success",
        "warning": "warning",
        "danger": "error",
        "overlay": "footer-background",
        "selection": "input-selection-background",
    }
    for item in presets():
        generated = (
            build_textual_theme(item.name, item.colors, dark=item.profile != "light")
            .to_color_system()
            .generate()
        )
        for semantic_name, textual_name in theme_tokens.items():
            rendered = Color.parse(generated[textual_name])
            expected = Color.parse(getattr(item.colors, semantic_name))
            assert (
                max(
                    abs(rendered.r - expected.r),
                    abs(rendered.g - expected.g),
                    abs(rendered.b - expected.b),
                    abs(rendered.a - expected.a),
                )
                <= 1
            ), item.name
        rendered_selection = Color.parse(generated["screen-selection-background"])
        expected_selection = Color.parse(item.colors.selection)
        assert (
            max(
                abs(rendered_selection.r - expected_selection.r),
                abs(rendered_selection.g - expected_selection.g),
                abs(rendered_selection.b - expected_selection.b),
                abs(rendered_selection.a - expected_selection.a),
            )
            <= 1
        ), item.name


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
