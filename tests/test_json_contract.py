from __future__ import annotations

import json
from pathlib import Path

import jsonschema
from typer.testing import CliRunner

from hcb import cli
from hcb.json_contract import JSON_COMMANDS, bundle
from hcb.models import Account
from hcb.paths import AppPaths
from hcb.runtime import Runtime
from hcb.storage import Storage


def _leaf_commands(command: object, prefix: tuple[str, ...] = ()) -> set[str]:
    commands = getattr(command, "commands", None)
    if not isinstance(commands, dict):
        return {".".join(prefix)}
    return {
        item for name, child in commands.items() for item in _leaf_commands(child, (*prefix, name))
    }


def test_json_registry_matches_the_public_command_tree() -> None:
    from typer.main import get_command

    actual = _leaf_commands(get_command(cli.app))
    schema_commands = set(bundle()["$defs"]["command"]["enum"])
    assert actual == set(JSON_COMMANDS) == schema_commands


def test_json_schema_validates_published_golden_fixtures() -> None:
    validator = jsonschema.Draft202012Validator(bundle())
    fixture_dir = Path(__file__).parent / "fixtures" / "json-contract-v1"
    for fixture in sorted(fixture_dir.glob("*.json")):
        validator.validate(json.loads(fixture.read_text(encoding="utf-8")))


def test_json_schema_validates_real_cli_success_and_error(tmp_path, monkeypatch) -> None:
    paths = AppPaths(tmp_path / "config", tmp_path / "data", tmp_path / "cache")
    with Storage(paths.database_file) as storage:
        storage.upsert_account(Account("work", "work@example.test"))
    monkeypatch.setattr(cli, "_runtime_factory", lambda: Runtime(paths, environ={}))
    runner = CliRunner()
    validator = jsonschema.Draft202012Validator(bundle())

    success = runner.invoke(cli.app, ["--json", "tasks", "list"])
    assert success.exit_code == 0
    validator.validate(json.loads(success.stdout))

    failure = runner.invoke(cli.app, ["--json", "tasks", "complete", "missing"])
    assert failure.exit_code == 3
    actual = json.loads(failure.stdout)
    validator.validate(actual)
    assert actual["error"]["code"] == "not_found"
