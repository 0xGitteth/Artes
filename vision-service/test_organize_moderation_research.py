import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from organize_moderation_research import (
    COLLECTION, apply, plan, undo, category,
)


class ConsolidateArtesResearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / 'Artes'
        self.project.mkdir()
        (self.project / '.git').mkdir()
        (self.project / '.gitignore').write_text('.tmp/\n')
        tmp = self.project / '.tmp'
        tmp.mkdir()
        self.tmp = tmp
        for name in ('moderation-v2', 'moderation-nsfw-pilot',
                     'moderation-independent-discovery',
                     'moderation-test-images', 'moderation-test-set'):
            d = tmp / name
            d.mkdir()
            (d / 'preserve.bin').write_bytes(b'important_private_model_data')
        (tmp / 'other_project_cache').mkdir()

    def test_plan_does_not_modify_and_apply_preserves_old_paths(self):
        intended = plan(self.project)
        self.assertEqual(len(intended), 5)
        self.assertFalse((self.tmp / COLLECTION).exists())
        self.assertEqual(category('moderation-independent-holdout'), 'eindtest')
        self.assertEqual(category('moderation-test-images'), 'testmateriaal')
        self.assertEqual(category('moderation-test-set'), 'testmateriaal')
        result = apply(self.project)
        self.assertEqual(result['moved'], 5)
        for rec in intended:
            original = self.tmp / rec['from']
            moved = self.tmp / rec['to']
            self.assertTrue(original.is_symlink())
            self.assertTrue(moved.is_dir())
            self.assertEqual((original / 'preserve.bin').read_bytes(),
                             b'important_private_model_data')
            # All existing scripts can keep writing to the OLD path.
            (original / 'result.json').write_text('{}\n')
            self.assertEqual((moved / 'result.json').read_text(), '{}\n')
        self.assertTrue((self.tmp / 'other_project_cache').exists())
        reverted = undo(self.project)
        self.assertEqual(reverted['restored'], 5)
        self.assertFalse((self.tmp / COLLECTION).exists())
        for rec in intended:
            original = self.tmp / rec['from']
            self.assertTrue(original.is_dir())
            self.assertFalse(original.is_symlink())
            self.assertEqual((original / 'preserve.bin').read_bytes(),
                             b'important_private_model_data')

    def test_undo_refuses_tampered_origin_link(self):
        apply(self.project)
        origin = self.tmp / 'moderation-v2'
        origin.unlink()
        origin.mkdir()
        with self.assertRaisesRegex(ValueError, 'original_link_or_destination_changed'):
            undo(self.project)

    def test_untracked_other_files_remain_unchanged(self):
        (self.tmp / 'misc.txt').write_text('leave alone')
        apply(self.project)
        self.assertEqual((self.tmp / 'misc.txt').read_text(), 'leave alone')


if __name__ == '__main__':
    unittest.main()
