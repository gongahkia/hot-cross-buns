#!/usr/bin/env python3
"""Install Hot Cross Buns from the canonical source repository.

The bootstrapper deliberately has no third-party dependencies: it runs before
HCB and its package dependencies exist. It uses uv when available and falls
back to pipx, while keeping the underlying command visible and repeatable.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

CANONICAL_REPOSITORY = "https://github.com/gongahkia/hot-cross-buns.git"
DEFAULT_REF = "main"
PACKAGE_NAME = "hot-cross-buns"
REF_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]*\Z")


class InstallerError(RuntimeError):
    """A recoverable installation error with a useful user-facing message."""


@dataclass(frozen=True, slots=True)
class InstallTarget:
    """A local checkout or canonical Git source passed to a package manager."""

    package_spec: str
    description: str


class Presentation:
    """Render a compact, accessible installation progress surface."""

    panel_width = 36

    def __init__(self, *, no_animate: bool, no_color: bool, verbose: bool) -> None:
        self.stdout = sys.stdout
        self.stderr = sys.stderr
        self.verbose = verbose
        terminal = self.stdout.isatty() and os.environ.get("TERM", "dumb") != "dumb"
        encoding = (self.stdout.encoding or "").lower()
        self.unicode = "utf" in encoding
        self.color = terminal and not no_color and not os.environ.get("NO_COLOR")
        self.animate = terminal and not no_animate
        self.frames = ("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")
        if not self.unicode:
            self.frames = ("|", "/", "-", "\\")
        self._surface_height = 0

    def _style(self, message: str, code: str) -> str:
        return f"\033[{code}m{message}\033[0m" if self.color else message

    def _symbol(self, unicode_symbol: str, ascii_symbol: str) -> str:
        return unicode_symbol if self.unicode else ascii_symbol

    def banner(self, *, preview: bool = False) -> None:
        title = self._style("Hot Cross Buns", "1;38;5;209")
        subtitle = "Local-first tasks and calendars for your terminal"
        if self.unicode:
            print(f"\n{title}  {self._style(self._symbol('•', '*'), '38;5;244')}  {subtitle}")
        else:
            print(f"\n{title} - {subtitle}")
        message = (
            "Previewing the installer. No files, packages, or HCB data will change."
            if preview
            else "Installing without touching Google credentials or local HCB data."
        )
        print(self._style(message, "38;5;244"))

    def note(self, message: str) -> None:
        print(f"  {self._style(self._symbol('›', '>'), '38;5;244')} {message}")

    def success(self, message: str) -> None:
        print(f"  {self._style(self._symbol('✓', 'OK'), '32')} {message}")

    def warning(self, message: str) -> None:
        print(f"  {self._style(self._symbol('!', '!'), '33')} {message}")

    def error(self, message: str) -> None:
        print(f"  {self._style(self._symbol('✗', 'ERROR'), '31')} {message}", file=self.stderr)

    def _panel_line(self, content: str, *, tone: str | None = None) -> str:
        vertical = self._symbol("│", "|")
        line = f"  {vertical}{content[: self.panel_width].ljust(self.panel_width)}{vertical}"
        return self._style(line, tone) if tone else line

    def _panel_top(self, title: str) -> str:
        top_left = self._symbol("╭", "+")
        top_right = self._symbol("╮", "+")
        horizontal = self._symbol("─", "-")
        content = f" {title[: self.panel_width - 2]} "
        return f"  {top_left}{content}{horizontal * (self.panel_width - len(content))}{top_right}"

    def _panel_bottom(self) -> str:
        bottom_left = self._symbol("╰", "+")
        bottom_right = self._symbol("╯", "+")
        horizontal = self._symbol("─", "-")
        return f"  {bottom_left}{horizontal * self.panel_width}{bottom_right}"

    def _stage_bar(self, stage: int, total: int, frame: int) -> str:
        width = 12
        completed = (stage - 1) * width // total
        active = min(width - 1, completed + frame // 2)
        cells = "".join(
            "█" if index < completed else "▓" if index == active else "░" for index in range(width)
        )
        return f"[{cells}]  {stage}/{total}"

    def _draw_surface(self, lines: Sequence[str]) -> None:
        if self._surface_height:
            print(f"\033[{self._surface_height}A", end="", flush=True)
        for line in lines:
            print(f"\r\033[2K{line}")
        self._surface_height = len(lines)

    def _render_progress(self, label: str, stage: int, total: int, frame: int) -> None:
        spinner = self.frames[frame % len(self.frames)]
        self._draw_surface(
            (
                self._style(self._panel_top("HCB installer"), "38;5;244"),
                self._panel_line(f" {self._stage_bar(stage, total, frame)}", tone="38;5;209"),
                self._panel_line(f" {spinner} {label}", tone="38;5;209"),
                self._panel_line(" Google setup is not required", tone="38;5;244"),
                self._style(self._panel_bottom(), "38;5;244"),
            )
        )

    def _finish_surface(
        self, title: str, first_line: str, second_line: str, *, succeeded: bool = True
    ) -> None:
        first_symbol = self._symbol("✓", "OK") if succeeded else self._symbol("✗", "ERROR")
        second_symbol = self._symbol("✓", "OK") if succeeded else self._symbol("!", "!")
        result_tone = "32" if succeeded else "31"
        footer = (
            " Google setup remains optional"
            if succeeded
            else " Review the installer log before retrying"
        )
        self._draw_surface(
            (
                self._style(self._panel_top(title), "38;5;244"),
                self._panel_line(f" {first_symbol} {first_line}", tone=result_tone),
                self._panel_line(f" {second_symbol} {second_line}", tone=result_tone),
                self._panel_line(footer, tone="38;5;244"),
                self._style(self._panel_bottom(), "38;5;244"),
            )
        )
        self._surface_height = 0

    def complete_installation(self, executable: str | None) -> None:
        """Leave a concise completion surface in interactive terminal scrollback."""

        if self.animate:
            self._finish_surface(
                "HCB is ready",
                "Installation complete",
                "hcb command verified" if executable else "Add the tool directory to PATH",
            )
        else:
            self.success("Hot Cross Buns is ready.")

    def preview(self) -> None:
        """Show the complete animated experience without invoking an installer."""

        stages = ("Preparing the workspace", "Installing HCB", "Checking the hcb command")
        if not self.animate:
            for index, label in enumerate(stages, start=1):
                self.note(f"[{index}/{len(stages)}] {label}")
            self.success("Preview complete. No changes were made.")
            return

        for stage, label in enumerate(stages, start=1):
            for frame in range(10):
                self._render_progress(label, stage, len(stages), frame)
                time.sleep(0.08)
        self._finish_surface(
            "Installer preview", "Visual preview complete", "No files were changed"
        )

    def run_step(
        self,
        label: str,
        command: Sequence[str],
        log_path: Path,
        *,
        stage: int,
        total_stages: int,
    ) -> None:
        if self.verbose:
            self.note(f"Running: {shlex_join(command)}")
        if not self.animate:
            self.note(f"[{stage}/{total_stages}] {label}")

        with log_path.open("a", encoding="utf-8") as log_file:
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                text=True,
            )
            frame = 0
            try:
                while process.poll() is None:
                    if self.animate:
                        self._render_progress(label, stage, total_stages, frame)
                        frame += 1
                    time.sleep(0.08)
            except KeyboardInterrupt:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                raise

        if process.returncode == 0:
            if not self.animate:
                self.success(label)
            return

        if self.animate:
            self._finish_surface(
                "Installation stopped",
                f"{label} failed",
                "Installer output is shown below",
                succeeded=False,
            )
        self.error(f"{label} failed.")
        self._show_log_tail(log_path)
        raise InstallerError(f"The installation log is available at {log_path}.")

    def _show_log_tail(self, log_path: Path) -> None:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        if lines:
            print("\nLast installer output:", file=self.stderr)
            print("\n".join(lines[-20:]), file=self.stderr)


def shlex_join(command: Sequence[str]) -> str:
    """Display a command without evaluating it or relying on a shell."""

    return " ".join(
        repr(part) if any(char.isspace() for char in part) else part for part in command
    )


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Install Hot Cross Buns with a compact terminal progress display.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    source_group = parser.add_mutually_exclusive_group()
    source_group.add_argument(
        "--source",
        type=Path,
        help="install from a local HCB checkout instead of GitHub",
    )
    source_group.add_argument(
        "--ref",
        default=DEFAULT_REF,
        help="canonical Git branch, tag, or commit to install",
    )
    parser.add_argument(
        "--tool",
        choices=("auto", "uv", "pipx"),
        default="auto",
        help="isolated Python installer to use",
    )
    parser.add_argument(
        "--no-animate",
        action="store_true",
        help="disable the animated progress surface",
    )
    parser.add_argument(
        "--no-color",
        action="store_true",
        help="disable ANSI color output",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="show the exact package-manager command",
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--demo",
        action="store_true",
        help="preview the animated installer without changing anything",
    )
    mode_group.add_argument(
        "--dry-run",
        action="store_true",
        help="show the installation plan without changing anything",
    )
    return parser.parse_args(argv)


def select_tool(preference: str) -> str:
    available = {tool for tool in ("uv", "pipx") if shutil.which(tool)}
    if preference != "auto":
        if preference not in available:
            raise InstallerError(f"Requested installer '{preference}' is not available on PATH.")
        return preference
    if "uv" in available:
        return "uv"
    if "pipx" in available:
        return "pipx"
    raise InstallerError(
        "HCB needs uv (recommended) or pipx. Install one, then run this bootstrapper again.\n"
        "uv: https://docs.astral.sh/uv/getting-started/installation/\n"
        "pipx: https://pipx.pypa.io/stable/installation/"
    )


def resolve_target(args: argparse.Namespace) -> InstallTarget:
    if args.source is not None:
        source = args.source.expanduser().resolve()
        project_file = source / "pyproject.toml"
        if not source.is_dir() or not project_file.is_file():
            raise InstallerError(
                f"'{source}' is not an HCB source checkout (pyproject.toml is missing)."
            )
        project_metadata = project_file.read_text(encoding="utf-8", errors="replace")
        if not re.search(
            r'^name\s*=\s*["\']hot-cross-buns["\']\s*$', project_metadata, re.MULTILINE
        ):
            raise InstallerError(
                f"'{source}' is not an HCB source checkout (project name is not hot-cross-buns)."
            )
        return InstallTarget(str(source), f"local checkout: {source}")

    ref = args.ref
    if not REF_PATTERN.fullmatch(ref) or ref.startswith("/") or ".." in ref:
        raise InstallerError(
            "--ref must be a simple Git branch, tag, or commit from the canonical repo."
        )
    return InstallTarget(
        f"git+{CANONICAL_REPOSITORY}@{ref}",
        f"canonical source: {CANONICAL_REPOSITORY}@{ref}",
    )


def install_command(tool: str, target: InstallTarget) -> list[str]:
    if tool == "uv":
        return ["uv", "tool", "install", "--reinstall", target.package_spec]
    return ["pipx", "install", "--force", target.package_spec]


def require_safe_environment() -> None:
    if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
        raise InstallerError(
            "Refusing to install as root. Run this as the person who will use HCB."
        )


def hcb_command() -> str | None:
    executable = shutil.which("hcb")
    return executable if executable and Path(executable).is_file() else None


def show_success(ui: Presentation, executable: str | None) -> None:
    ui.complete_installation(executable)
    print()
    if executable:
        ui.note("Start with: hcb")
    else:
        ui.warning("HCB was installed, but its executable directory is not on this shell's PATH.")
        ui.note("Run 'uv tool update-shell' (or 'pipx ensurepath'), then open a new shell.")
        ui.note("Start with: hcb")
    ui.note("Google setup remains optional and happens only when you choose it in HCB.")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    ui = Presentation(no_animate=args.no_animate, no_color=args.no_color, verbose=args.verbose)

    if args.demo:
        ui.banner(preview=True)
        ui.preview()
        return 0

    ui.banner()

    try:
        require_safe_environment()
        target = resolve_target(args)
        tool = select_tool(args.tool)
        command = install_command(tool, target)
        ui.note(f"Source: {target.description}")
        ui.note(f"Installer: {tool}")

        if args.dry_run:
            ui.note(f"Would run: {shlex_join(command)}")
            ui.success("Dry run complete. No changes were made.")
            return 0

        descriptor, log_name = tempfile.mkstemp(prefix="hcb-install-", suffix=".log")
        os.close(descriptor)
        log_path = Path(log_name)
        keep_log = False
        try:
            ui.run_step("Installing Hot Cross Buns", command, log_path, stage=1, total_stages=2)
            executable = hcb_command()
            if executable:
                ui.run_step(
                    "Verifying the hcb command",
                    [executable, "--json-schema-version"],
                    log_path,
                    stage=2,
                    total_stages=2,
                )
            show_success(ui, executable)
            return 0
        except InstallerError:
            keep_log = True
            raise
        except KeyboardInterrupt:
            keep_log = True
            ui.error(f"Installation cancelled. The installation log is available at {log_path}.")
            return 130
        finally:
            if not keep_log:
                log_path.unlink(missing_ok=True)
    except InstallerError as error:
        ui.error(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
