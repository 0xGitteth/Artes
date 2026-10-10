import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from prepare_independent_holdout import (
    hamming, scan, seal, validate_draft, visual_hash,
)


class HoldoutIntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'images').mkdir()
        self.development = self.root / 'development'
        self.development.mkdir()
        pixels = Image.new('RGB', (27, 16))
        for y in range(16):
            for x in range(27):
                pixels.putpixel((x, y), (255-x*9, y*11, 40))
        pixels.save(self.root / 'images' / 'new_photo.png')
        self.image = self.root / 'images' / 'new_photo.png'
        self.expected = visual_hash(self.image)
        self.assertGreater(hamming(self.expected, '0000000000000000'), 6)

    def fake_development(self, _development=None):
        return set(), {'training_group'}, ['0000000000000000']

    def test_scan_then_complete_rights_and_seal_without_private_image_paths(self):
        with patch('prepare_independent_holdout.read_development', self.fake_development):
            result = scan(self.development, self.root)
            self.assertEqual(result['candidateImages'], 1)
            draft_path = self.root / 'holdout-draft.json'
            draft = json.loads(draft_path.read_text())
            self.assertEqual(draft['images'][0]['sourceGroup'], '')
            self.assertEqual(draft['images'][0]['sexualContext'], '')
            with self.assertRaisesRegex(ValueError, 'already_exists'):
                scan(self.development, self.root)
            with self.assertRaisesRegex(ValueError, 'holdout_source_group_missing'):
                seal(self.development, self.root)

            row = draft['images'][0]
            row.update({
                'sourceGroup': 'new_source_001',
                'sexualContext': 'explicit_act',
                'nudity': 'none',
                'adultSubjectsVerified': True,
                'useRightsConfirmed': True,
                'rightsEvidenceRef': 'approved_private_license_record',
                'artesResearchNoveltyConfirmed': True,
                'independenceNote': 'Not previously in Artes research or same shoot.',
            })
            draft_path.write_text(json.dumps(draft))
            sealed = seal(self.development, self.root)
            self.assertEqual(sealed['total'], 1)
            self.assertEqual(sealed['groups'], 1)
            self.assertEqual(sealed['contexts']['explicit_act'], 1)
            self.assertTrue((self.root / 'holdout-sealed.json').exists())
            aggregate = (self.root / 'holdout-intake-aggregate.json').read_text()
            self.assertNotIn('new_photo.png', aggregate)
            self.assertNotIn('approved_private_license_record', aggregate)
            self.assertNotIn(row['sha256'], aggregate)
            with self.assertRaisesRegex(ValueError, 'already_sealed'):
                seal(self.development, self.root)

    def test_exact_or_perceptual_duplicate_is_rejected(self):
        with patch('prepare_independent_holdout.read_development',
                   return_value=(set(), set(), [self.expected])):
            with self.assertRaisesRegex(ValueError, 'visual_near_duplicate'):
                scan(self.development, self.root)
        with patch('prepare_independent_holdout.read_development',
                   return_value=({hashlib.sha256(self.image.read_bytes()).hexdigest()},
                                 set(), [])):
            with self.assertRaisesRegex(ValueError, 'duplicate_image_hash'):
                scan(self.development, self.root)

    def test_missing_labels_and_rights_never_seal(self):
        with patch('prepare_independent_holdout.read_development', self.fake_development):
            scan(self.development, self.root)
        draft = json.loads((self.root / 'holdout-draft.json').read_text())
        row = draft['images'][0]
        row.update({'sourceGroup': 'training_group', 'sexualContext': 'none',
                    'nudity': 'none'})
        with self.assertRaisesRegex(ValueError, 'development_overlap'):
            validate_draft(draft, [dict(imagePath=row['imagePath'],
                                       sha256=row['sha256'],
                                       dhash=row['dhash'])], {'training_group'})
        row['sourceGroup'] = 'new_source_002'
        with self.assertRaisesRegex(ValueError, 'consent_rights'):
            validate_draft(draft, [dict(imagePath=row['imagePath'],
                                       sha256=row['sha256'],
                                       dhash=row['dhash'])], {'training_group'})

    def test_bad_image_data_rejected(self):
        self.image.write_bytes(b'not a picture')
        with patch('prepare_independent_holdout.read_development', self.fake_development):
            with self.assertRaises(Exception):
                scan(self.development, self.root)


if __name__ == '__main__':
    unittest.main()
