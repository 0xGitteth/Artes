import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from evaluate_nsfw_development import (
    LABELS, load_development_rows, score_development, summarize,
)

REVISION = '7c914c1a94ac1a8d16af7982101756f5650b870a'
LABELS_TO_SIGNALS = {
    'normal': 'nsfw_normal_category', 'porn': 'nsfw_porn_category',
    'hentai': 'nsfw_hentai_category', 'drawing': 'nsfw_drawing_category',
    'sexy': 'nsfw_sexy_category',
}


def fake_inference(porn_probability):
    other = (1.0 - porn_probability) / 4
    values = {name: (porn_probability if name == 'porn' else other)
              for name in LABELS_TO_SIGNALS}
    return {
        'signals': [{'type': LABELS_TO_SIGNALS[name], 'confidence': value}
                    for name, value in values.items()],
        'uncertain': True,
    }


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = self.root / 'approved'
        self.output = self.root / 'outputs'
        data = {
            'train': [
                self.make_row(1, 'train', 'none', 'genitalia'),
                self.make_row(2, 'train', 'explicit_act', 'genitalia'),
                self.make_row(3, 'train', 'suggestive', 'female_bare_breasts'),
            ],
            'validation': [
                self.make_row(4, 'validation', 'explicit_act', 'underwear_swimwear'),
            ],
        }
        for split, rows in data.items():
            (self.data / f'{split}.json').write_text(json.dumps(rows))

    def make_row(self, number, split, context, nudity):
        image_directory = self.data / split / 'images'
        image_directory.mkdir(parents=True, exist_ok=True)
        filename = f'{number}.png'
        Image.new('RGB', (2, 2), (number * 30, 0, 0)).save(image_directory / filename)
        return {
            'sha256': f'{number:064x}', 'sourceGroup': f'group_{number}',
            'sexualContext': context, 'nudity': nudity,
            'imagePath': f'{split}/images/{filename}',
        }

    def test_loads_only_development_splits(self):
        rows = load_development_rows(self.data)
        self.assertEqual(len(rows), 4)
        self.assertEqual({row['split'] for row in rows}, {'train', 'validation'})

    def test_resume_keeps_private_prediction_cache_and_writes_aggregate_summary(self):
        with patch('evaluate_nsfw_development.classify_nsfw',
                   side_effect=[fake_inference(.10), fake_inference(.95)]) as classify:
            first = score_development(self.data, self.output, REVISION, 2)
            self.assertEqual(first['developmentImagesScored'], 2)
            self.assertEqual(classify.call_count, 2)

        with patch('evaluate_nsfw_development.classify_nsfw',
                   side_effect=[fake_inference(.05), fake_inference(.8)]) as classify:
            final = score_development(self.data, self.output, REVISION, None)
            self.assertEqual(classify.call_count, 2)

        self.assertEqual(final['developmentImagesScored'], 4)
        self.assertEqual(final['developmentSourceGroups'], 4)
        self.assertEqual(final['humanLabelCounts']['explicit_act'], 2)
        self.assertEqual(final['descriptivePornScoreAtHalf']['explicitActAboveHalf'], 2)
        self.assertEqual(final['descriptivePornScoreAtHalf']['nonExplicitNudityAboveHalf'], 0)
        self.assertEqual(final['rawPornScoreExplicitActRanking']['auroc'], 1)
        self.assertEqual(len((self.output / 'nsfw-private-development-scores.jsonl').read_text().splitlines()), 4)
        self.assertNotIn('imagePath', (self.output / 'nsfw-development-summary.json').read_text())

    def test_rejects_test_split_path_in_development_manifest(self):
        train = json.loads((self.data / 'train.json').read_text())
        train[0]['imagePath'] = 'test/images/not-allowed.png'
        (self.data / 'train.json').write_text(json.dumps(train))
        with self.assertRaises(ValueError):
            load_development_rows(self.data)

    def test_detects_source_group_crossing_train_validation(self):
        train = json.loads((self.data / 'train.json').read_text())
        validation = json.loads((self.data / 'validation.json').read_text())
        validation[0]['sourceGroup'] = train[0]['sourceGroup']
        (self.data / 'validation.json').write_text(json.dumps(validation))
        with self.assertRaisesRegex(ValueError, 'source_group_crosses_dev_splits'):
            load_development_rows(self.data)


if __name__ == '__main__':
    unittest.main()
