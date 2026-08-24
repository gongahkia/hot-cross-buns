from __future__ import annotations

from pathlib import Path

from hcb.environment import detect_local_environment


def test_detects_ghostty_theme_from_macos_standard_location(tmp_path: Path) -> None:
    config = (
        tmp_path / "Library" / "Application Support" / "com.mitchellh.ghostty" / "config.ghostty"
    )
    config.parent.mkdir(parents=True)
    config.write_text('theme = "Rose Pine"\n', encoding="utf-8")

    environment = detect_local_environment(
        {"TERM_PROGRAM": "Ghostty"},
        home=tmp_path,
        system_name="Darwin",
        machine_name="arm64",
    )

    assert environment.platform_name == "macOS"
    assert environment.architecture == "arm64"
    assert environment.terminal_name == "Ghostty"
    assert environment.terminal_theme == "Rose Pine"
    assert environment.theme_source == config
    assert environment.suggested_preset == "Rose Pine"


def test_detects_wsl_and_windows_terminal_profile_scheme(tmp_path: Path) -> None:
    settings = (
        tmp_path
        / "Packages"
        / "Microsoft.WindowsTerminal_8wekyb3d8bbwe"
        / "LocalState"
        / "settings.json"
    )
    settings.parent.mkdir(parents=True)
    settings.write_text(
        '{"defaultProfile":"{work}","profiles":{"defaults":{},"list":['
        '{"guid":"{work}","colorScheme":"TokyoNight Storm"}]}}',
        encoding="utf-8",
    )

    environment = detect_local_environment(
        {
            "LOCALAPPDATA": str(tmp_path),
            "WSL_DISTRO_NAME": "Ubuntu",
            "WT_SESSION": "session",
        },
        home=tmp_path / "home",
        system_name="Linux",
        machine_name="x86_64",
    )

    assert environment.platform_name == "WSL (Ubuntu)"
    assert environment.terminal_name == "Windows Terminal"
    assert environment.terminal_theme == "TokyoNight Storm"
    assert environment.suggested_preset == "TokyoNight Storm"


def test_detects_a_newly_bundled_ghostty_theme(tmp_path: Path) -> None:
    config = tmp_path / ".config" / "ghostty" / "config.ghostty"
    config.parent.mkdir(parents=True)
    config.write_text("theme = Flexoki Light\n", encoding="utf-8")

    environment = detect_local_environment(
        {"TERM_PROGRAM": "Ghostty"},
        home=tmp_path,
        system_name="Linux",
        machine_name="x86_64",
    )

    assert environment.terminal_theme == "Flexoki Light"
    assert environment.suggested_preset == "Flexoki Light"


def test_unknown_theme_is_reported_without_a_preset_or_config_write(tmp_path: Path) -> None:
    config = tmp_path / ".config" / "ghostty" / "config.ghostty"
    config.parent.mkdir(parents=True)
    config.write_text("theme = Personal Palette\n", encoding="utf-8")

    environment = detect_local_environment(
        {"TERM_PROGRAM": "Ghostty"},
        home=tmp_path,
        system_name="Linux",
        machine_name="aarch64",
    )

    assert environment.platform_name == "Linux"
    assert environment.terminal_theme == "Personal Palette"
    assert environment.suggested_preset is None
    assert config.read_text(encoding="utf-8") == "theme = Personal Palette\n"
