import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from finish_moderation_workspace_cleanup import inspect, apply, undo, EDITOR_GLOBS


class FinishCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "Artes"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True,
                       stdout=subprocess.DEVNULL)
        (self.root / ".gitignore").write_text(".tmp/\n.vscode/*\n")
        self.tmp = self.root / ".tmp"
        self.tmp.mkdir()
        self.collection = self.tmp / "Artes_Moderatie_Onderzoek"
        (self.collection / "datasets" / "moderation-v2").mkdir(parents=True)
        (self.collection / "datasets" / "moderation-v2" / "important.json").write_text('{"keep":1}')
        (self.tmp / "moderation-v2").symlink_to(
            "Artes_Moderatie_Onderzoek/datasets/moderation-v2", target_is_directory=True)
        (self.collection / "organization-manifest.json").write_text(json.dumps({
            "version": 1,
            "entries": [{"from": "moderation-v2",
                         "to": "Artes_Moderatie_Onderzoek/datasets/moderation-v2"}]
        }))
        (self.root / "Artes_training_start.pyz").write_bytes(b"training-app-archive")
        (self.root / "Artes_trainingsresultaat.zip").write_bytes(b"irreplaceable-old-results")
        (self.root / "balanced-target-scene-labels.reviewed.json").write_text('{"human":true}')
        (self.root / "AGENTS.md").write_text("important instructions")
        (self.root / "firebase.json").write_text("{}")
        (self.root / "firestore-debug.log").write_text("active log")
        (self.tmp / "vision-external-research-v1.log").write_text("historic diagnostics")
        (self.tmp / "web-research-v1-review.zip").write_bytes(b"research zip")
        (self.tmp / "artes-training-348-20261008").mkdir()
        (self.tmp / "artes-training-348-20261008" / "train.json").write_text('{"preserved":true}')

    def test_preview_and_apply_only_safe_artifacts(self):
        entries, skipped, before = inspect(self.root)
        self.assertEqual(len(entries), 6)
        self.assertFalse((self.collection / "additional-cleanup-manifest.json").exists())
        self.assertIsNone(before)
        result = apply(self.root)
        self.assertEqual(result["moved"], 6)
        self.assertFalse((self.root / "Artes_trainingsresultaat.zip").exists())
        archived = self.collection / "oude_archieven" / "Artes_trainingsresultaat.zip"
        self.assertEqual(archived.read_bytes(), b"irreplaceable-old-results")
        self.assertTrue((self.tmp / "artes-training-348-20261008").is_symlink())
        self.assertEqual((self.tmp / "artes-training-348-20261008" / "train.json").read_text(),
                         '{"preserved":true}')
        self.assertEqual((self.root / "AGENTS.md").read_text(), "important instructions")
        self.assertTrue((self.tmp / "moderation-v2").is_symlink())
        self.assertTrue((self.collection / "organization-manifest.json").exists())
        self.assertTrue((self.root / "firestore-debug.log").exists())
        settings = json.loads((self.root / ".vscode" / "settings.json").read_text())
        for key, value in EDITOR_GLOBS.items():
            self.assertEqual(settings["files.exclude"][key], value)
        undone = undo(self.root)
        self.assertEqual(undone["restored"], 6)
        self.assertFalse((self.tmp / "artes-training-348-20261008").is_symlink())
        self.assertEqual((self.root / "Artes_trainingsresultaat.zip").read_bytes(),
                         b"irreplaceable-old-results")
        self.assertFalse((self.root / ".vscode" / "settings.json").exists())

    def test_git_tracked_archive_is_left_at_root(self):
        p = self.root / "Artes_training_start.pyz"
        subprocess.run(["git", "-C", str(self.root), "add", "-f", p.name],
                       check=True, stdout=subprocess.DEVNULL)
        entries, skipped, _ = inspect(self.root)
        self.assertFalse(any(e["from"] == p.name for e in entries))
        self.assertTrue(any(s["name"] == p.name and s["why"] == "tracked_in_git"
                            for s in skipped))

    def test_do_not_overwrite_existing_user_settings(self):
        folder = self.root / ".vscode"
        folder.mkdir()
        original = '{"files.exclude": {".tmp/moderation-*": false}, "editor.wordWrap": "on"}\n'
        (folder / "settings.json").write_text(original)
        apply(self.root)
        settings = json.loads((folder / "settings.json").read_text())
        self.assertEqual(settings["files.exclude"][".tmp/moderation-*"], False)
        self.assertEqual(settings["editor.wordWrap"], "on")
        (folder / "settings.json").write_text('{"editor.wordWrap":"off"}\n')
        with self.assertRaisesRegex(ValueError, "editor_settings_changed"):
            undo(self.root)

    def test_existing_cleanup_is_not_reapplied(self):
        apply(self.root)
        with self.assertRaisesRegex(ValueError, "second_stage_already_applied"):
            inspect(self.root)


if __name__ == "__main__":
    unittest.main()
