"""Reminder delivery state and database diagnostics persistence."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .models import ConflictStatus
from .storage import _iso, _StorageCore


class ReminderRepository(_StorageCore):
    def set_reminder(
        self,
        account_id: str,
        event_id: str,
        remind_at: datetime,
        *,
        occurrence_id: str | None = None,
        notified_at: datetime | None = None,
        dismissed_at: datetime | None = None,
    ) -> None:
        self.connection.execute(
            """INSERT INTO reminder_state VALUES (?,?,?,?,?,?) ON CONFLICT DO UPDATE SET
            notified_at=excluded.notified_at,dismissed_at=excluded.dismissed_at""",
            (
                account_id,
                event_id,
                occurrence_id or "",
                _iso(remind_at),
                _iso(notified_at),
                _iso(dismissed_at),
            ),
        )

    def due_reminders(self, account_id: str, now: datetime) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """SELECT * FROM reminder_state WHERE account_id=? AND remind_at<=?
            AND notified_at IS NULL AND dismissed_at IS NULL ORDER BY remind_at""",
            (account_id, _iso(now)),
        )
        return [dict(row) for row in rows]

    def ensure_reminder_delivery(
        self,
        account_id: str,
        source_type: str,
        source_id: str,
        scheduled_at: datetime,
        *,
        occurrence_id: str | None = None,
    ) -> None:
        self.connection.execute(
            """INSERT OR IGNORE INTO reminder_deliveries(
                account_id,source_type,source_id,occurrence_id,scheduled_at
            ) VALUES (?,?,?,?,?)""",
            (account_id, source_type, source_id, occurrence_id or "", _iso(scheduled_at)),
        )

    def due_reminder_deliveries(
        self, account_id: str, now: datetime, earliest: datetime
    ) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """SELECT * FROM reminder_deliveries
            WHERE account_id=? AND delivered_at IS NULL AND dismissed_at IS NULL
            AND (scheduled_at>=? OR snoozed_until IS NOT NULL) AND scheduled_at<=?
            AND (snoozed_until IS NULL OR snoozed_until<=?)
            ORDER BY COALESCE(snoozed_until,scheduled_at)""",
            (account_id, _iso(earliest), _iso(now), _iso(now)),
        )
        return [dict(row) for row in rows]

    def update_reminder_delivery(
        self,
        row: dict[str, Any],
        *,
        delivered_at: datetime | None = None,
        dismissed_at: datetime | None = None,
        snoozed_until: datetime | None = None,
        error: str | None = None,
    ) -> None:
        self.connection.execute(
            """UPDATE reminder_deliveries SET delivered_at=?,dismissed_at=?,
            snoozed_until=?,last_error=?,attempts=attempts+1
            WHERE account_id=? AND source_type=? AND source_id=?
            AND occurrence_id=? AND scheduled_at=?""",
            (
                _iso(delivered_at),
                _iso(dismissed_at),
                _iso(snoozed_until),
                error,
                row["account_id"],
                row["source_type"],
                row["source_id"],
                row["occurrence_id"],
                row["scheduled_at"],
            ),
        )

    def reminder_delivery_rows(self, account_id: str) -> list[dict[str, Any]]:
        return [
            dict(row)
            for row in self.connection.execute(
                "SELECT * FROM reminder_deliveries WHERE account_id=? ORDER BY scheduled_at",
                (account_id,),
            )
        ]

    def diagnostics(self) -> dict[str, Any]:
        integrity = self.connection.execute("PRAGMA quick_check").fetchone()[0]
        return {
            "database": self.path.name,
            "schema_version": self.connection.execute("PRAGMA user_version").fetchone()[0],
            "journal_mode": self.connection.execute("PRAGMA journal_mode").fetchone()[0],
            "foreign_keys": bool(self.connection.execute("PRAGMA foreign_keys").fetchone()[0]),
            "integrity": integrity,
            "accounts": self.connection.execute("SELECT count(*) FROM accounts").fetchone()[0],
            "pending_mutations": self.connection.execute("SELECT count(*) FROM outbox").fetchone()[
                0
            ],
            "open_conflicts": self.connection.execute(
                "SELECT count(*) FROM conflicts WHERE status=?", (ConflictStatus.OPEN.value,)
            ).fetchone()[0],
        }
