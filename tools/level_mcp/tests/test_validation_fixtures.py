import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from level_mcp import level_store


class ValidationFixtureTests(unittest.TestCase):
    def test_shared_validation_fixtures(self) -> None:
        fixture_path = Path(__file__).resolve().parents[3] / "levels" / "validation-fixtures.v1.json"
        for case in json.loads(fixture_path.read_text())["cases"]:
            with self.subTest(case=case["id"]):
                report = level_store.validate(case["document"])
                self.assertEqual(report["error_codes"], case["error_codes"])
                self.assertEqual(report["warning_codes"], case["warning_codes"])

    def test_revision_conflict_rollback_and_playtest_retention(self) -> None:
        previous_root = os.environ.get("ASW_PROJECT_ROOT")
        with tempfile.TemporaryDirectory() as temporary:
            os.environ["ASW_PROJECT_ROOT"] = temporary
            try:
                draft = level_store.blank_draft("history", "History")
                level_store.save_draft(draft)
                added = level_store.apply_transaction("history", {"action": "add_module", "module": {"id": "reset", "kind": "reset", "position": [0, 0, 0], "spawn": [0, 1, 0]}}, 0)
                self.assertTrue(added["ok"])
                self.assertTrue(level_store.apply_transaction("history", {"action": "add_module", "module": {"kind": "platform", "position": [2, 0, 0]}}, 0)["conflict"])
                restored = level_store.rollback("history", 0, 1)
                self.assertTrue(restored["ok"])
                self.assertEqual(restored["revision"], 2)
                self.assertTrue(level_store.revision_diff("history", 1))
                self.assertTrue(level_store.publish("history", 2)["ok"])
                lock_path = level_store._lock_root("history")
                lock_path.mkdir(parents=True)
                (lock_path / "owner.json").write_text("{}")
                locked = level_store.apply_transaction("history", {"action": "add_module", "module": {"kind": "platform", "position": [2, 0, 0]}}, 2)
                self.assertFalse(locked["ok"])
                shutil.rmtree(lock_path)
                for index in range(11):
                    current = level_store.load_draft("history")["revision"]
                    self.assertTrue(level_store.apply_transaction("history", {"action": "add_module", "module": {"id": f"p-{index}", "kind": "platform", "position": [index + 2, 0, 0]}}, current)["ok"])
                self.assertTrue((level_store._history_root("history") / "snapshots" / "10.level.json").exists())
                self.assertNotIn("before", level_store.revision_diff("history", 3))
                self.assertTrue(level_store.rollback("history", 5, level_store.load_draft("history")["revision"])["ok"])
                for index in range(22):
                    level_store.save_playtest_report("history", {"saved_at": index + 1, "checkpoints": [], "events": [], "path": []})
                self.assertEqual(len(level_store.playtest_reports("history")), level_store.PLAYTEST_LIMIT)
            finally:
                if previous_root is None:
                    os.environ.pop("ASW_PROJECT_ROOT", None)
                else:
                    os.environ["ASW_PROJECT_ROOT"] = previous_root
