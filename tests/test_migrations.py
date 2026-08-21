from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from hcb import storage as storage_module
from hcb.models import Account, TaskList
from hcb.storage import SCHEMA_VERSION, Storage


def _legacy_database(path: Path, version: int) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(storage_module._SCHEMA)
    connection.execute("PRAGMA user_version = 1")
    if version >= 2:
        connection.executescript(storage_module._MIGRATION_2)
        connection.execute("PRAGMA user_version = 2")
    if version >= 3:
        connection.executescript(storage_module._MIGRATION_3)
        connection.execute("PRAGMA user_version = 3")
    if version >= 4:
        connection.executescript(storage_module._MIGRATION_4)
        connection.execute("PRAGMA user_version = 4")
    connection.execute(
        """INSERT INTO accounts(id,email,display_name,provider,enabled,created_at)
        VALUES ('legacy','redacted@example.test',NULL,'google',1,'2026-08-21T00:00:00+00:00')"""
    )
    connection.execute(
        """INSERT INTO task_lists(
            id,account_id,title,remote_id,position,etag,remote_updated_at,
            local_updated_at,deleted,dirty
        ) VALUES ('inbox','legacy','Legacy inbox',NULL,0,NULL,NULL,
                  '2026-08-21T00:00:00+00:00',0,0)"""
    )
    connection.execute(
        """INSERT INTO outbox(
            account_id,entity_type,entity_id,operation,payload,created_at,attempts,last_error
        ) VALUES (
            'legacy','task','local-task','create','{"body":{"title":"Legacy intent"}}',
            '2026-08-21T00:00:00+00:00',0,NULL
        )"""
    )
    connection.commit()
    connection.close()


def test_fresh_database_and_repeated_open_are_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "fresh.db"
    with Storage(path) as storage:
        storage.upsert_account(Account("fresh", "redacted@example.test"))
        storage.upsert_task_list(TaskList("inbox", "fresh", "Inbox"))
        assert storage.connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION

    for _ in range(3):
        with Storage(path) as reopened:
            assert reopened.get_task_list("fresh", "inbox") is not None
            version = reopened.connection.execute("PRAGMA user_version").fetchone()[0]
            assert version == SCHEMA_VERSION


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_v1_v2_v3_v4_migrate_to_current_without_data_loss(tmp_path: Path, version: int) -> None:
    path = tmp_path / f"v{version}.db"
    _legacy_database(path, version)

    with Storage(path) as migrated:
        assert migrated.connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert migrated.get_account("legacy") is not None
        assert migrated.get_task_list("legacy", "inbox").title == "Legacy inbox"
        columns = {row["name"] for row in migrated.connection.execute("PRAGMA table_info(events)")}
        assert "working_location_properties" in columns
        outbox_columns = {
            row["name"] for row in migrated.connection.execute("PRAGMA table_info(outbox)")
        }
        assert {"delivery_state", "request_id", "sending_started_at"} <= outbox_columns
        mutation = migrated.pending_mutations("legacy")[0]
        assert mutation.delivery_state.value == "pending"
        assert mutation.payload["body"]["title"] == "Legacy intent"
        assert migrated.connection.execute("PRAGMA quick_check").fetchone()[0] == "ok"

    with Storage(path) as repeated:
        assert repeated.connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert repeated.get_task_list("legacy", "inbox") is not None
