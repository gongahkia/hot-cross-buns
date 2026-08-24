"""Characterization tests for the dependency-free HCB bootstrapper."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
INSTALLER = ROOT / "scripts" / "install-hcb.py"


def run_installer(*args: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ | {"NO_COLOR": "1", "TERM": "dumb"}
    return subprocess.run(
        [sys.executable, str(INSTALLER), *args],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def test_installer_help_describes_safe_and_accessible_options() -> None:
    result = run_installer("--help")

    assert result.returncode == 0
    assert "--source" in result.stdout
    assert "--ref" in result.stdout
    assert "--no-animate" in result.stdout
    assert "--demo" in result.stdout
    assert "--dry-run" in result.stdout


def test_dry_run_uses_the_canonical_repository_without_ansi_output() -> None:
    result = run_installer("--dry-run")

    assert result.returncode == 0
    assert "git+https://github.com/gongahkia/hot-cross-buns.git@main" in result.stdout
    assert "Dry run complete. No changes were made." in result.stdout
    assert "\x1b[" not in result.stdout


def test_dry_run_accepts_a_local_checkout(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "hot-cross-buns"\n')

    result = run_installer("--source", str(tmp_path), "--dry-run")

    assert result.returncode == 0
    assert f"local checkout: {tmp_path}" in result.stdout


def test_demo_is_a_no_change_preview_without_ansi_output() -> None:
    result = run_installer("--demo")

    assert result.returncode == 0
    assert "Previewing the installer" in result.stdout
    assert "Preview complete. No changes were made." in result.stdout
    assert "\x1b[" not in result.stdout


def test_demo_and_dry_run_are_mutually_exclusive() -> None:
    result = run_installer("--demo", "--dry-run")

    assert result.returncode == 2
    assert "not allowed with argument" in result.stderr


def test_installer_rejects_a_non_checkout_source(tmp_path: Path) -> None:
    result = run_installer("--source", str(tmp_path), "--dry-run")

    assert result.returncode == 1
    assert "pyproject.toml is missing" in result.stderr


def test_installer_rejects_a_non_hcb_checkout(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "another-project"\n')

    result = run_installer("--source", str(tmp_path), "--dry-run")

    assert result.returncode == 1
    assert "project name is not hot-cross-buns" in result.stderr


def test_installer_rejects_ambiguous_git_refs() -> None:
    result = run_installer("--ref", "../untrusted", "--dry-run")

    assert result.returncode == 1
    assert "simple Git branch, tag, or commit" in result.stderr
