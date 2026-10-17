import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from scripts.convert_google_snapshot import ConversionError, convert


ZONE = ZoneInfo("Asia/Singapore")
AS_OF = datetime(2026, 10, 15, 12, 0, tzinfo=ZONE)


def collection(items):
    return {"pages": [{"items": items}]}


def sample_snapshot():
    master = {
        "id": "series-a", "summary": "Weekly standup",
        "status": "confirmed", "start": {"dateTime": "2026-10-12T09:00:00+08:00"},
        "end": {"dateTime": "2026-10-12T09:30:00+08:00"},
        "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        "description": "Agenda\nDecisions", "reminders": {"overrides": [{"method": "popup", "minutes": 30}]},
    }
    return {
        "format": "shio-pan-google-raw-v1",
        "calendarList": collection([{"id": "primary", "timeZone": "Asia/Singapore"}]),
        "taskLists": collection([{"id": "a", "title": "Inbox"}]),
        "tasksByList": [{"taskListId": "a", "tasks": collection([
            {"id": "open-undated", "status": "needsAction", "title": "Idea", "notes": "one\ntwo"},
            {"id": "open-dated", "status": "needsAction", "title": "Call", "due": "2026-10-16T00:00:00.000Z"},
            {"id": "done", "status": "completed", "title": "Old task"},
            {"id": "deleted", "status": "needsAction", "deleted": True, "title": "Deleted task"},
        ])}],
        "calendarEvents": [{"calendarId": "primary", "events": collection([
            master,
            {"id": "skip", "status": "cancelled", "recurringEventId": "series-a", "originalStartTime": {"dateTime": "2026-10-26T09:00:00+08:00"}},
            {"id": "moved", "status": "confirmed", "summary": "Weekly standup", "recurringEventId": "series-a",
             "originalStartTime": {"dateTime": "2026-11-02T09:00:00+08:00"},
             "start": {"dateTime": "2026-11-03T10:00:00+08:00"}, "end": {"dateTime": "2026-11-03T10:30:00+08:00"}},
            {"id": "overnight", "status": "confirmed", "summary": "Night shift",
             "start": {"dateTime": "2026-10-16T22:00:00+08:00"}, "end": {"dateTime": "2026-10-17T06:00:00+08:00"},
             "location": "Office", "hangoutLink": "https://meet.example/x"},
            {"id": "all-day", "status": "confirmed", "summary": "Conference",
             "start": {"date": "2026-10-18"}, "end": {"date": "2026-10-21"}},
            {"id": "past", "status": "confirmed", "summary": "Old meeting",
             "start": {"dateTime": "2026-10-01T09:00:00+08:00"}, "end": {"dateTime": "2026-10-01T10:00:00+08:00"}},
        ])}],
    }


class GoogleConversionTests(unittest.TestCase):
    def test_upcoming_only_preserves_sparse_exceptions_and_undated_lists(self):
        output, counts = convert(sample_snapshot(), AS_OF, False)
        self.assertEqual(counts["undated_tasks"], 1)
        self.assertEqual(counts["dated_tasks"], 1)
        self.assertEqual(counts["series"], 1)
        self.assertEqual(counts["skips"], 1)
        self.assertEqual(counts["replacements"], 1)
        self.assertIn("  @repeat: weekly on mon; series weekly-standup-20261012-", output)
        self.assertIn("  @skip: 2026-10-26", output)
        self.assertLess(output.index("  @skip: 2026-10-26"), output.index("- [ ] Agenda"))
        self.assertIn("  @replaces: weekly-standup-20261012-", output)
        self.assertIn("  @span: 22:00 to 2026-10-17 06:00", output)
        self.assertIn("  @span: all-day through 2026-10-20", output)
        self.assertIn("Location: Office", output)
        self.assertIn("Meeting link: https://meet.example/x", output)
        self.assertIn("UNDATED\n\nLIST: Inbox\nIdea\n- one\n- two", output)
        self.assertNotIn("Old meeting", output)
        self.assertNotIn("Old task", output)
        self.assertNotIn("Deleted task", output)
        self.assertNotIn("@remind", output)

    def test_past_event_option_keeps_history_and_open_tasks_only(self):
        output, counts = convert(sample_snapshot(), AS_OF, True)
        self.assertIn("Old meeting", output)
        self.assertEqual(counts["series"], 1)
        self.assertNotIn("Old task", output)

    def test_unknown_rrule_stops_instead_of_silently_dropping_data(self):
        snapshot = sample_snapshot()
        snapshot["calendarEvents"][0]["events"]["pages"][0]["items"][0]["recurrence"] = ["RRULE:FREQ=HOURLY"]
        with self.assertRaisesRegex(ConversionError, "cannot yet be represented"):
            convert(snapshot, AS_OF, False)

    def test_sunday_week_start_is_kept_for_fortnightly_rules(self):
        snapshot = sample_snapshot()
        master = snapshot["calendarEvents"][0]["events"]["pages"][0]["items"][0]
        master["recurrence"] = ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU"]
        output, _ = convert(snapshot, AS_OF, False)
        self.assertIn("; week starts sun", output)

    def test_moved_past_occurrence_now_upcoming_is_kept(self):
        snapshot = sample_snapshot()
        events = snapshot["calendarEvents"][0]["events"]["pages"][0]["items"]
        events.append({"id": "old-occurrence-moved-future", "status": "confirmed", "summary": "Rescheduled review",
                       "recurringEventId": "series-a", "originalStartTime": {"dateTime": "2026-10-05T09:00:00+08:00"},
                       "start": {"dateTime": "2026-10-20T09:00:00+08:00"},
                       "end": {"dateTime": "2026-10-20T09:30:00+08:00"}})
        output, counts = convert(snapshot, AS_OF, False)
        self.assertIn("09:00-09:30 Rescheduled review", output)
        self.assertEqual(counts["moved_standalone"], 1)

    def test_equal_google_list_names_remain_separate_shio-pan_lists(self):
        snapshot = sample_snapshot()
        snapshot["taskLists"]["pages"][0]["items"].append({"id": "b", "title": "Inbox"})
        snapshot["tasksByList"].append({"taskListId": "b", "tasks": collection([
            {"id": "another-open", "status": "needsAction", "title": "Another idea"},
        ])})
        output, counts = convert(snapshot, AS_OF, False)
        self.assertEqual(counts["undated_tasks"], 2)
        self.assertIn("LIST: Inbox\nIdea", output)
        self.assertIn("LIST: Inbox (2)\nAnother idea", output)


if __name__ == "__main__":
    unittest.main()
