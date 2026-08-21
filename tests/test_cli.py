from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from hcb import cli
from hcb.models import Account
from hcb.paths import AppPaths
from hcb.runtime import Runtime
from hcb.storage import Storage
from hcb.sync import SyncResult


class MemoryTokens:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, account_id: str) -> str | None:
        return self.values.get(account_id)

    def set(self, account_id: str, token: str) -> None:
        self.values[account_id] = token

    def delete(self, account_id: str) -> bool:
        return self.values.pop(account_id, None) is not None


@pytest.fixture
def cli_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[CliRunner, AppPaths]:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    tokens = MemoryTokens()
    monkeypatch.setattr(
        cli,
        "_runtime_factory",
        lambda: Runtime(paths, environ={}, token_store=tokens),  # type: ignore[arg-type]
    )
    with Storage(paths.database_file) as storage:
        storage.upsert_account(Account("work", "me@example.com"))
    return CliRunner(), paths


def invoke(runner: CliRunner, args: list[str], input: str | None = None) -> Any:
    result = runner.invoke(cli.app, args, input=input)
    assert result.exception is None, result.output
    return result


def seed_list(runner: CliRunner) -> str:
    result = invoke(runner, ["--json", "task-lists", "create", "Inbox"])
    return str(json.loads(result.stdout)["id"])


def seed_calendar(runner: CliRunner) -> str:
    result = invoke(runner, ["--json", "calendars", "create", "Personal"])
    return str(json.loads(result.stdout)["id"])


def test_help_has_completion_and_full_command_groups(cli_env: tuple[CliRunner, AppPaths]) -> None:
    runner, _ = cli_env
    result = invoke(runner, ["--help"])
    for command in (
        "tasks",
        "task-lists",
        "notes",
        "events",
        "calendars",
        "saved-searches",
        "conflicts",
        "import",
        "export",
        "auth",
        "config",
        "doctor",
        "find-time",
        "daemon",
    ):
        assert command in result.stdout
    assert "--show-completion" in result.stdout
    completion = runner.invoke(
        cli.app,
        [],
        prog_name="hcb",
        env={"_HCB_COMPLETE": "source_bash"},
    )
    assert completion.exit_code == 0
    assert "_hcb_completion" in completion.stdout


def test_task_crud_json_tsv_and_notes(cli_env: tuple[CliRunner, AppPaths]) -> None:
    runner, _ = cli_env
    list_id = seed_list(runner)
    created = invoke(
        runner,
        [
            "--json",
            "tasks",
            "create",
            "Ship CLI",
            "--list",
            list_id,
            "--due",
            "2026-08-22",
            "--priority",
            "high",
        ],
    )
    task = json.loads(created.stdout)
    assert task["title"] == "Ship CLI"
    assert task["due"] == "2026-08-22"
    invoke(runner, ["notes", "set", task["id"], "-"], input="from stdin\n")
    shown = invoke(runner, ["--json", "notes", "show", task["id"]])
    assert json.loads(shown.stdout)["notes"] == "from stdin\n"
    invoke(runner, ["tasks", "complete", task["id"]])
    listed = invoke(runner, ["--tsv", "tasks", "list", "--completed"])
    assert listed.stdout.startswith("id\tlist_id\ttitle\tstatus")
    assert "Ship CLI" in listed.stdout
    invoke(runner, ["tasks", "delete", task["id"], "--yes"])
    empty = invoke(runner, ["--json", "tasks", "list", "--completed"])
    assert json.loads(empty.stdout) == []


def test_destructive_commands_require_yes_when_not_tty(
    cli_env: tuple[CliRunner, AppPaths],
) -> None:
    runner, _ = cli_env
    list_id = seed_list(runner)
    result = runner.invoke(cli.app, ["task-lists", "delete", list_id])
    assert result.exit_code == 2
    assert "--yes" in result.stderr
    assert "Traceback" not in result.output


def test_events_search_saved_search_and_capture(cli_env: tuple[CliRunner, AppPaths]) -> None:
    runner, _ = cli_env
    list_id = seed_list(runner)
    calendar_id = seed_calendar(runner)
    event = invoke(
        runner,
        [
            "--json",
            "events",
            "create",
            "Planning",
            "--calendar",
            calendar_id,
            "--start",
            "2026-08-22",
            "--end",
            "2026-08-23",
            "--all-day",
        ],
    )
    event_id = json.loads(event.stdout)["id"]
    agenda = invoke(
        runner, ["--json", "events", "agenda", "--from", "2026-08-22", "--to", "2026-08-24"]
    )
    assert json.loads(agenda.stdout)[0]["id"] == event_id
    found = invoke(runner, ["--json", "search", "Planning"])
    assert json.loads(found.stdout)[0]["kind"] == "event"
    saved = invoke(runner, ["--json", "saved-searches", "save", "plan", "Planning"])
    saved_id = json.loads(saved.stdout)["id"]
    rerun = invoke(runner, ["--json", "saved-searches", "run", saved_id])
    assert json.loads(rerun.stdout)[0]["id"] == event_id
    captured = invoke(
        runner,
        ["--json", "capture", "-", "--list", list_id],
        input="task Buy milk tomorrow p1\n",
    )
    assert json.loads(captured.stdout)["title"] == "Buy milk"


def test_import_preview_apply_and_export(
    cli_env: tuple[CliRunner, AppPaths], tmp_path: Path
) -> None:
    runner, _ = cli_env
    list_id = seed_list(runner)
    source = tmp_path / "items.json"
    source.write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {"kind": "task", "title": "Imported", "list": list_id, "priority": "none"}
                ],
            }
        )
    )
    preview = invoke(runner, ["--json", "import", "preview", str(source)])
    assert json.loads(preview.stdout)["rows"][0]["record"]["title"] == "Imported"
    invoke(runner, ["import", "apply", str(source), "--yes"])
    exported = invoke(runner, ["export", "--format", "json"])
    assert json.loads(exported.stdout)["records"][0]["title"] == "Imported"
    csv_output = tmp_path / "out.csv"
    invoke(runner, ["export", "--format", "csv", "--output", str(csv_output)])
    assert csv_output.read_text().startswith("kind,title,")


def test_config_commands_and_account_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    env = {"HCB_ACCOUNT": "second"}
    monkeypatch.setattr(cli, "_runtime_factory", lambda: Runtime(paths, environ=env))
    with Storage(paths.database_file) as storage:
        storage.upsert_account(Account("first", "first@example.com"))
        storage.upsert_account(Account("second", "second@example.com"))
    runner = CliRunner()
    invoke(runner, ["config", "init"])
    invoke(runner, ["config", "set", "preferences.week_starts_on", "6"])
    shown = invoke(runner, ["--json", "config", "show"])
    assert json.loads(shown.stdout)["preferences"]["week_starts_on"] == 6
    assert invoke(runner, ["task-lists", "create", "Second"]).exit_code == 0
    with Storage(paths.database_file) as storage:
        assert len(storage.list_task_lists("second")) == 1
        assert storage.list_task_lists("first") == []


def test_local_reads_do_not_construct_google_or_keyring(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    with Storage(paths.database_file) as storage:
        storage.upsert_account(Account("work", "me@example.com"))

    def explode() -> None:
        raise AssertionError("keyring was constructed")

    monkeypatch.setattr("hcb.runtime.TokenStore", explode)
    monkeypatch.setattr(cli, "_runtime_factory", lambda: Runtime(paths, environ={}))
    result = CliRunner().invoke(cli.app, ["tasks", "list"])
    assert result.exit_code == 0


def test_sync_is_explicit_network_boundary(
    cli_env: tuple[CliRunner, AppPaths], monkeypatch: pytest.MonkeyPatch
) -> None:
    runner, paths = cli_env
    calls: list[str] = []

    class Engine:
        def sync(self, account_id: str) -> SyncResult:
            calls.append(account_id)
            return SyncResult(pulled=2, pushed=1)

    class SyncRuntime(Runtime):
        def sync_engine(self, account_id: str) -> Engine:
            return Engine()

    monkeypatch.setattr(
        cli,
        "_runtime_factory",
        lambda: SyncRuntime(paths, environ={}, token_store=MemoryTokens()),  # type: ignore[arg-type]
    )
    result = invoke(runner, ["--json", "sync"])
    assert json.loads(result.stdout)["pulled"] == 2
    assert calls == ["work"]


def test_expected_not_found_uses_stable_exit_without_traceback(
    cli_env: tuple[CliRunner, AppPaths],
) -> None:
    runner, _ = cli_env
    result = runner.invoke(cli.app, ["tasks", "complete", "missing"])
    assert result.exit_code == 3
    assert "does not exist" in result.stderr
    assert "Traceback" not in result.output
