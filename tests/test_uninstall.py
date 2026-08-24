"""Safety and ownership tests for HCB's complete local teardown."""

from __future__ import annotations

import json
import os
from pathlib import Path

from typer.testing import CliRunner

from hcb import cli
from hcb.credentials import credential_key_account
from hcb.paths import AppPaths
from hcb.runtime import Runtime
from hcb.uninstall import RemovalProgress, build_plan, execute_plan, package_removal


class MemoryTokens:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, account_id: str) -> str | None:
        return self.values.get(account_id)

    def set(self, account_id: str, token: str) -> None:
        self.values[account_id] = token

    def delete(self, account_id: str) -> bool:
        return self.values.pop(account_id, None) is not None


def test_package_removal_detects_only_supported_tool_environments() -> None:
    def find(command: str) -> str:
        return f"/tools/{command}"

    uv = package_removal("auto", prefix=Path("/tmp/uv/tools/hot-cross-buns"), find_executable=find)
    pipx = package_removal(
        "auto", prefix=Path("/tmp/pipx/venvs/hot-cross-buns"), find_executable=find
    )

    assert uv is not None and uv.command == ("/tools/uv", "tool", "uninstall", "hot-cross-buns")
    assert pipx is not None and pipx.command == ("/tools/pipx", "uninstall", "hot-cross-buns")
    assert package_removal("auto", prefix=Path("/tmp/project/.venv"), find_executable=find) is None


def test_complete_teardown_removes_only_hcb_owned_paths(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    credential_file = paths.config_dir / "accounts" / "work.env"
    credential_file.parent.mkdir(parents=True)
    credential_file.write_text("HCB_GOOGLE_CLIENT_ID=test\n", encoding="utf-8")
    paths.data_dir.mkdir(parents=True)
    paths.cache_dir.mkdir(parents=True)
    (paths.data_dir / "hcb.sqlite3").write_text("not a real database", encoding="utf-8")
    (paths.cache_dir / "reminderd-status.json").write_text("{}", encoding="utf-8")
    unrelated = tmp_path / "unrelated.txt"
    unrelated.write_text("keep me", encoding="utf-8")
    tokens = MemoryTokens()
    tokens.set(credential_key_account(credential_file), "encryption-key")
    plan = build_plan(
        paths,
        active_credential_file=credential_file,
        credential_file_is_explicit=True,
        include_explicit_credential_file=False,
        package=None,
    )

    result = execute_plan(
        plan,
        progress=RemovalProgress(enabled=False),
        keyring_store=tokens,  # type: ignore[arg-type]
    )

    assert not paths.config_dir.exists()
    assert not paths.data_dir.exists()
    assert not paths.cache_dir.exists()
    assert unrelated.read_text(encoding="utf-8") == "keep me"
    assert tokens.values == {}
    assert result.package_removal == "kept"


def test_explicit_external_credential_file_requires_opt_in(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    external = tmp_path / "external.env"
    external.write_text("HCB_GOOGLE_CLIENT_ID=test\n", encoding="utf-8")
    plan = build_plan(
        paths,
        active_credential_file=external,
        credential_file_is_explicit=True,
        include_explicit_credential_file=False,
        package=None,
    )

    assert plan.excluded_credential_file == external
    assert external.resolve() not in plan.credential_key_files
    assert all(target.path != external for target in plan.targets)

    included = build_plan(
        paths,
        active_credential_file=external,
        credential_file_is_explicit=True,
        include_explicit_credential_file=True,
        package=None,
    )
    assert included.excluded_credential_file is None
    assert external.resolve() in included.credential_key_files
    assert any(target.path == external for target in included.targets)


def test_macos_plan_includes_only_hcb_owned_reminder_artifacts(tmp_path: Path) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    home = tmp_path / "home"
    plan = build_plan(
        paths,
        active_credential_file=paths.config_dir / "personal.env",
        credential_file_is_explicit=False,
        include_explicit_credential_file=False,
        package=None,
        platform_name="darwin",
        home=home,
    )

    assert (
        plan.launch_agent_path == home / "Library/LaunchAgents/com.hot-cross-buns.reminderd.plist"
    )
    assert {target.path for target in plan.targets} >= {
        plan.launch_agent_path,
        home / "Library/Logs/hcb-reminderd.log",
    }


def test_cli_uninstall_requires_yes_and_keeps_state_intact(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    paths.config_dir.mkdir(parents=True)
    paths.config_file.write_text("{}\n", encoding="utf-8")
    paths.data_dir.mkdir()
    paths.cache_dir.mkdir()
    tokens = MemoryTokens()
    monkeypatch.setattr(
        cli,
        "_runtime_factory",
        lambda: Runtime(paths, environ={}, token_store=tokens),  # type: ignore[arg-type]
    )

    result = CliRunner().invoke(cli.app, ["uninstall", "--keep-program"])

    assert result.exit_code == 2
    assert "requires --yes" in result.stderr
    assert paths.config_file.exists()
    assert paths.data_dir.exists()


def test_cli_uninstall_dry_run_and_confirmed_cleanup(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    credential_file = paths.config_dir / "personal.env"
    credential_file.parent.mkdir(parents=True)
    credential_file.write_text("HCB_GOOGLE_CLIENT_ID=test\n", encoding="utf-8")
    paths.data_dir.mkdir()
    paths.cache_dir.mkdir()
    tokens = MemoryTokens()
    tokens.set(credential_key_account(credential_file), "encryption-key")
    monkeypatch.setattr(
        cli,
        "_runtime_factory",
        lambda: Runtime(
            paths,
            environ={},
            token_store=tokens,  # type: ignore[arg-type]
            credential_file=credential_file,
        ),
    )
    runner = CliRunner()

    preview = runner.invoke(cli.app, ["--json", "uninstall", "--dry-run", "--keep-program"])
    assert preview.exit_code == 0
    plan = json.loads(preview.stdout)["data"]
    assert plan["keep_program"] is True
    assert credential_file.exists()

    removed = runner.invoke(cli.app, ["--json", "uninstall", "--yes", "--keep-program"])
    assert removed.exit_code == 0, removed.output
    result = json.loads(removed.stdout)["data"]
    assert result["package_removal"] == "kept"
    assert result["google_data_unchanged"] is True
    assert not paths.config_dir.exists()
    assert not paths.data_dir.exists()
    assert not paths.cache_dir.exists()
    assert tokens.values == {}


def test_cli_uninstall_refuses_an_active_manual_daemon(tmp_path: Path, monkeypatch) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    paths.config_dir.mkdir(parents=True)
    paths.data_dir.mkdir()
    paths.cache_dir.mkdir()
    (paths.cache_dir / "reminderd.pid").write_text(str(os.getpid()), encoding="ascii")
    monkeypatch.setattr(
        cli,
        "_runtime_factory",
        lambda: Runtime(paths, environ={}, token_store=MemoryTokens()),  # type: ignore[arg-type]
    )

    result = CliRunner().invoke(cli.app, ["uninstall", "--yes", "--keep-program"])

    assert result.exit_code == 2
    assert "stop that daemon first" in result.stderr
    assert paths.data_dir.exists()
