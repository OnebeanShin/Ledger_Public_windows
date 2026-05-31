import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import hledger_api


class HledgerMtimeCacheTest(unittest.TestCase):
    def setUp(self):
        hledger_api.clear_hledger_cache()

    def tearDown(self):
        hledger_api.clear_hledger_cache()

    def test_journal_signature_tracks_nested_includes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "main.journal"
            nested_dir = root / "nested"
            nested_dir.mkdir()
            child = root / "child.journal"
            nested = nested_dir / "more.journal"
            main.write_text("include child.journal\n", encoding="utf-8")
            child.write_text("include nested/more.journal\n", encoding="utf-8")
            nested.write_text("2026-01-01 open\n", encoding="utf-8")

            before = hledger_api.get_journal_mtime_signature(str(main))
            nested.write_text("2026-01-01 changed\n", encoding="utf-8")
            after = hledger_api.get_journal_mtime_signature(str(main))

            self.assertNotEqual(before, after)
            self.assertIn(str(nested.resolve()), {entry[0] for entry in after})

    def test_run_reuses_successful_response_until_included_journal_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "main.journal"
            child = root / "child.journal"
            main.write_text("include child.journal\n", encoding="utf-8")
            child.write_text("2026-01-01 open\n", encoding="utf-8")

            calls = []

            def fake_run(cmd, **kwargs):
                calls.append(cmd)
                return SimpleNamespace(
                    returncode=0,
                    stdout=json.dumps({"call": len(calls)}),
                    stderr="",
                )

            with patch.object(hledger_api, "JOURNAL_FILE", str(main)), patch.object(
                hledger_api.subprocess, "run", side_effect=fake_run
            ):
                first = hledger_api._run(["balance"])
                second = hledger_api._run(["balance"])
                child.write_text("2026-01-01 changed\n", encoding="utf-8")
                third = hledger_api._run(["balance"])

            self.assertEqual(first, {"call": 1})
            self.assertEqual(second, {"call": 1})
            self.assertEqual(third, {"call": 2})
            self.assertEqual(len(calls), 2)

    def test_run_does_not_cache_hledger_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            main = Path(tmp) / "main.journal"
            main.write_text("", encoding="utf-8")
            calls = []

            def fake_run(cmd, **kwargs):
                calls.append(cmd)
                if len(calls) == 1:
                    return SimpleNamespace(returncode=1, stdout="", stderr="boom")
                return SimpleNamespace(returncode=0, stdout="[]", stderr="")

            with patch.object(hledger_api, "JOURNAL_FILE", str(main)), patch.object(
                hledger_api.subprocess, "run", side_effect=fake_run
            ):
                with self.assertRaises(RuntimeError):
                    hledger_api._run(["balance"])
                self.assertEqual(hledger_api._run(["balance"]), [])

            self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
