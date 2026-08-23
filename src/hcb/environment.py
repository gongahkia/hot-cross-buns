"""Local platform, terminal, and named-theme discovery for first-run setup."""

from __future__ import annotations

import json
import os
import platform
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .themes import presets

_GHOSTTY_SETTING = re.compile(r"^\s*theme\s*=\s*(?P<value>[^#\n]+)", re.MULTILINE)
_GHOSTTY_INCLUDE = re.compile(r"^\s*config-file\s*=\s*(?P<value>[^#\n]+)", re.MULTILINE)
_WEZTERM_SETTING = re.compile(r"(?:color_scheme|color_scheme_name)\s*=\s*[\"'](?P<value>[^\"']+)")
_KITTY_INCLUDE = re.compile(r"^\s*include\s+(?P<value>[^\s#]+)", re.MULTILINE)
_WINDOWS_SCHEME = re.compile(r'"colorScheme"\s*:\s*"(?P<value>[^"\\]+)"')


@dataclass(frozen=True, slots=True)
class LocalEnvironment:
    """A read-only summary of the current local terminal environment."""

    platform_name: str
    architecture: str
    terminal_name: str
    terminal_theme: str | None = None
    theme_source: Path | None = None
    suggested_preset: str | None = None

    @property
    def device_label(self) -> str:
        return f"{self.platform_name} · {self.architecture}"

    @property
    def terminal_label(self) -> str:
        return self.terminal_name


def detect_local_environment(
    environ: Mapping[str, str] | None = None,
    *,
    home: Path | None = None,
    system_name: str | None = None,
    machine_name: str | None = None,
    proc_version: str | None = None,
) -> LocalEnvironment:
    """Inspect only standard local terminal configuration files; never mutate or execute them."""
    environment = os.environ if environ is None else environ
    system = system_name or platform.system()
    home_directory = home or _home_directory(environment)
    platform_label = _platform_label(system, environment, proc_version)
    terminal = _terminal_name(environment)
    theme, source = _theme_from_terminal(terminal, environment, home_directory, system)
    return LocalEnvironment(
        platform_name=platform_label,
        architecture=machine_name or platform.machine() or "unknown architecture",
        terminal_name=terminal,
        terminal_theme=theme,
        theme_source=source,
        suggested_preset=_matching_preset(theme),
    )


def _home_directory(environ: Mapping[str, str]) -> Path:
    value = environ.get("USERPROFILE") if os.name == "nt" else environ.get("HOME")
    return Path(value).expanduser() if value else Path.home()


def _platform_label(system: str, environ: Mapping[str, str], proc_version: str | None) -> str:
    if system.casefold() == "darwin":
        return "macOS"
    if system.casefold() == "windows":
        return "Windows"
    version = proc_version if proc_version is not None else _linux_version()
    if (
        environ.get("WSL_DISTRO_NAME")
        or environ.get("WSL_INTEROP")
        or "microsoft" in version.casefold()
    ):
        distribution = environ.get("WSL_DISTRO_NAME")
        return f"WSL ({distribution})" if distribution else "WSL"
    if system.casefold() == "linux":
        return "Linux"
    return system or "Unknown platform"


def _linux_version() -> str:
    try:
        return Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _terminal_name(environ: Mapping[str, str]) -> str:
    if environ.get("WT_SESSION"):
        return "Windows Terminal"
    term_program = environ.get("TERM_PROGRAM", "").casefold()
    names = {
        "apple_terminal": "Terminal.app",
        "ghostty": "Ghostty",
        "hyper": "Hyper",
        "iterm.app": "iTerm2",
        "vscode": "VS Code terminal",
        "wezterm": "WezTerm",
    }
    if term_program in names:
        return names[term_program]
    if environ.get("KITTY_WINDOW_ID"):
        return "Kitty"
    if environ.get("ALACRITTY_LOG") or environ.get("ALACRITTY_SOCKET"):
        return "Alacritty"
    if environ.get("TMUX"):
        return "tmux"
    term = environ.get("TERM", "")
    if term.startswith("xterm-kitty"):
        return "Kitty"
    if term:
        return term
    return "Unknown terminal"


def _theme_from_terminal(
    terminal: str, environ: Mapping[str, str], home: Path, system: str
) -> tuple[str | None, Path | None]:
    if terminal == "Ghostty":
        return _ghostty_theme(environ, home, system)
    if terminal == "Windows Terminal":
        return _windows_terminal_theme(environ, home)
    if terminal == "WezTerm":
        return _wezterm_theme(environ, home)
    if terminal == "Kitty":
        return _kitty_theme(environ, home)
    return None, None


def _config_home(environ: Mapping[str, str], home: Path) -> Path:
    configured = environ.get("XDG_CONFIG_HOME")
    return Path(configured).expanduser() if configured else home / ".config"


def _ghostty_theme(
    environ: Mapping[str, str], home: Path, system: str
) -> tuple[str | None, Path | None]:
    config_home = _config_home(environ, home) / "ghostty"
    candidates = [
        config_home / "config.ghostty",
        config_home / "config",
    ]
    if system.casefold() == "darwin":
        macos_home = home / "Library" / "Application Support" / "com.mitchellh.ghostty"
        candidates.extend((macos_home / "config.ghostty", macos_home / "config"))
    theme: str | None = None
    source: Path | None = None
    for candidate in candidates:
        candidate_theme = _ghostty_theme_file(candidate, set())
        if candidate_theme is not None:
            theme = candidate_theme
            source = candidate
    return theme, source


def _ghostty_theme_file(path: Path, seen: set[Path]) -> str | None:
    resolved = path.expanduser().resolve(strict=False)
    if resolved in seen:
        return None
    seen.add(resolved)
    content = _read_config(path)
    if content is None:
        return None
    theme = _last_setting(_GHOSTTY_SETTING, content)
    for include in _GHOSTTY_INCLUDE.finditer(content):
        value = _clean_config_value(include.group("value")).lstrip("?")
        include_path = Path(value).expanduser()
        if not include_path.is_absolute():
            include_path = path.parent / include_path
        included_theme = _ghostty_theme_file(include_path, seen)
        if included_theme is not None:
            theme = included_theme
    return theme


def _windows_terminal_theme(
    environ: Mapping[str, str], home: Path
) -> tuple[str | None, Path | None]:
    local_app_data = Path(environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
    candidates = (
        local_app_data
        / "Packages"
        / "Microsoft.WindowsTerminal_8wekyb3d8bbwe"
        / "LocalState"
        / "settings.json",
        local_app_data
        / "Packages"
        / "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe"
        / "LocalState"
        / "settings.json",
        local_app_data / "Microsoft" / "Windows Terminal" / "settings.json",
    )
    for candidate in candidates:
        content = _read_config(candidate)
        if content is None:
            continue
        return _windows_scheme(content), candidate
    return None, None


def _windows_scheme(content: str) -> str | None:
    try:
        document = json.loads(content)
    except json.JSONDecodeError:
        match = _WINDOWS_SCHEME.search(content)
        return match.group("value") if match is not None else None
    profiles = document.get("profiles")
    if not isinstance(profiles, dict):
        return None
    defaults = profiles.get("defaults")
    default_scheme = defaults.get("colorScheme") if isinstance(defaults, dict) else None
    if isinstance(default_scheme, str):
        return default_scheme
    listed = profiles.get("list")
    if not isinstance(listed, list):
        return None
    default_profile = document.get("defaultProfile")
    candidates = [
        item for item in listed if isinstance(item, dict) and item.get("guid") == default_profile
    ] + [item for item in listed if isinstance(item, dict)]
    for item in candidates:
        scheme = item.get("colorScheme")
        if isinstance(scheme, str):
            return scheme
    return None


def _wezterm_theme(environ: Mapping[str, str], home: Path) -> tuple[str | None, Path | None]:
    candidates = (home / ".wezterm.lua", _config_home(environ, home) / "wezterm" / "wezterm.lua")
    for candidate in candidates:
        content = _read_config(candidate)
        if content is None:
            continue
        theme = _last_setting(_WEZTERM_SETTING, content)
        if theme is not None:
            return theme, candidate
    return None, None


def _kitty_theme(environ: Mapping[str, str], home: Path) -> tuple[str | None, Path | None]:
    candidate = _config_home(environ, home) / "kitty" / "kitty.conf"
    content = _read_config(candidate)
    if content is None:
        return None, None
    includes = list(_KITTY_INCLUDE.finditer(content))
    if not includes:
        return None, None
    include = Path(includes[-1].group("value"))
    return include.stem.replace("-", " ").replace("_", " "), candidate


def _read_config(path: Path) -> str | None:
    try:
        return path.expanduser().read_text(encoding="utf-8", errors="ignore")[:131_072]
    except OSError:
        return None


def _last_setting(pattern: re.Pattern[str], content: str) -> str | None:
    matches = list(pattern.finditer(content))
    return _clean_config_value(matches[-1].group("value")) if matches else None


def _clean_config_value(value: str) -> str:
    return value.strip().strip('"').strip("'").strip()


def _matching_preset(theme: str | None) -> str | None:
    if theme is None:
        return None
    normalized = _normalized_name(theme)
    for item in presets():
        if normalized in {_normalized_name(item.name), _normalized_name(item.upstream_name)}:
            return item.name
    return None


def _normalized_name(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())
