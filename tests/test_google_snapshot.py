import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from scripts.pull_google_snapshot import (
    CALENDAR_EVENTS_URL,
    CALENDAR_LIST_QUERY,
    CALENDAR_LIST_URL,
    EVENTS_QUERY,
    TASK_LISTS_QUERY,
    TASK_LISTS_URL,
    TASKS_QUERY,
    TASKS_URL,
    SnapshotError,
    export_snapshot,
    get_json,
    pages,
)


class Response:
    def __init__(self, payload=None, status=200, headers=None):
        self.payload = payload
        self.status_code = status
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


class ScriptedSession:
    def __init__(self, calls):
        self.calls = list(calls)

    def get(self, url, *, params, timeout):
        assert timeout == 60
        expected_url, expected_params, response = self.calls.pop(0)
        assert url == expected_url
        assert params == expected_params
        return response


class GoogleSnapshotTests(unittest.TestCase):
    def test_pulls_every_page_and_preserves_raw_calendar_and_task_records(self):
        first_calendar = {"id": "personal@example.com", "summary": "Personal ✨", "hidden": True}
        second_calendar = {"id": "other/calendar", "summary": "Other"}
        recurring = {"id": "repeat", "recurrence": ["RRULE:FREQ=WEEKLY"], "description": "Raw text"}
        cancelled = {"id": "exception", "status": "cancelled", "recurringEventId": "repeat"}
        hidden_task = {"id": "done", "title": "Finished", "status": "completed", "hidden": True}
        assigned_task = {"id": "assigned", "title": "Assigned", "assignmentInfo": {"linkToTask": "x"}}
        calls = [
            (CALENDAR_LIST_URL, CALENDAR_LIST_QUERY, Response({"items": [first_calendar], "nextPageToken": "c2"})),
            (CALENDAR_LIST_URL, {**CALENDAR_LIST_QUERY, "pageToken": "c2"}, Response({"items": [second_calendar]})),
            (CALENDAR_EVENTS_URL.format(calendar_id="personal%40example.com"), EVENTS_QUERY,
             Response({"items": [recurring], "nextPageToken": "e2", "etag": "one"})),
            (CALENDAR_EVENTS_URL.format(calendar_id="personal%40example.com"), {**EVENTS_QUERY, "pageToken": "e2"},
             Response({"items": [cancelled], "etag": "two"})),
            (CALENDAR_EVENTS_URL.format(calendar_id="other%2Fcalendar"), EVENTS_QUERY, Response({"items": []})),
            (TASK_LISTS_URL, TASK_LISTS_QUERY, Response({"items": [{"id": "list/1", "title": "All"}]})),
            (TASKS_URL.format(task_list_id="list%2F1"), TASKS_QUERY,
             Response({"items": [hidden_task], "nextPageToken": "t2"})),
            (TASKS_URL.format(task_list_id="list%2F1"), {**TASKS_QUERY, "pageToken": "t2"},
             Response({"items": [assigned_task]})),
        ]
        session = ScriptedSession(calls)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "nested" / "snapshot.json"
            counts = export_snapshot(session, output)
            snapshot = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(counts, {"calendars": 2, "events": 2, "taskLists": 1, "tasks": 2})
            self.assertEqual(snapshot["format"], "hito-google-raw-v1")
            self.assertEqual(snapshot["calendarList"]["pages"][0]["items"], [first_calendar])
            self.assertEqual(snapshot["calendarEvents"][0]["events"]["pages"][0]["items"], [recurring])
            self.assertEqual(snapshot["calendarEvents"][0]["events"]["pages"][1]["items"], [cancelled])
            self.assertEqual(snapshot["tasksByList"][0]["tasks"]["pages"][0]["items"], [hidden_task])
            self.assertEqual(snapshot["tasksByList"][0]["tasks"]["pages"][1]["items"], [assigned_task])
            self.assertFalse(snapshot["calendarEvents"][0]["events"]["request"]["singleEvents"])
            self.assertTrue(snapshot["tasksByList"][0]["tasks"]["request"]["showHidden"])
            self.assertTrue(snapshot["tasksByList"][0]["tasks"]["request"]["showAssigned"])
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertEqual(session.calls, [])

    def test_failed_request_leaves_no_partial_snapshot(self):
        session = ScriptedSession([
            (CALENDAR_LIST_URL, CALENDAR_LIST_QUERY, Response({"items": [{"id": "cal"}]})),
            (CALENDAR_EVENTS_URL.format(calendar_id="cal"), EVENTS_QUERY, Response(status=403)),
        ])
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "snapshot.json"
            with self.assertRaisesRegex(RuntimeError, "HTTP 403"):
                export_snapshot(session, output)
            self.assertFalse(output.exists())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_existing_export_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "snapshot.json"
            output.write_text("original", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                export_snapshot(ScriptedSession([]), output)
            self.assertEqual(output.read_text(encoding="utf-8"), "original")

    def test_repeated_pagination_token_is_an_error(self):
        session = ScriptedSession([
            (CALENDAR_LIST_URL, CALENDAR_LIST_QUERY, Response({"items": [], "nextPageToken": "same"})),
            (CALENDAR_LIST_URL, {**CALENDAR_LIST_QUERY, "pageToken": "same"},
             Response({"items": [], "nextPageToken": "same"})),
        ])
        with self.assertRaisesRegex(SnapshotError, "repeated pagination token"):
            list(pages(session, CALENDAR_LIST_URL, CALENDAR_LIST_QUERY))

    def test_transient_rate_limit_retries_the_same_request(self):
        session = ScriptedSession([
            (TASK_LISTS_URL, TASK_LISTS_QUERY, Response(status=429, headers={"Retry-After": "1"})),
            (TASK_LISTS_URL, TASK_LISTS_QUERY, Response({"items": []})),
        ])
        with patch("scripts.pull_google_snapshot.time.sleep") as sleep:
            self.assertEqual(get_json(session, TASK_LISTS_URL, TASK_LISTS_QUERY), {"items": []})
        sleep.assert_called_once_with(1)
        self.assertEqual(session.calls, [])


if __name__ == "__main__":
    unittest.main()
