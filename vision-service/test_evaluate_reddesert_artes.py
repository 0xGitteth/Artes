import json
import tempfile
import unittest
from pathlib import Path

from evaluate_reddesert_artes import (
    CLASSES, FILE_SHA256, aggregate, validate_probabilities,
    infer_publisher_layout, read_cache,
)


class RedDesertArtesTests(unittest.TestCase):
    def test_publisher_architecture_layout_is_explicitly_verified(self):
        self.assertEqual(infer_publisher_layout(['0.0.weight', '1.7.bias']),
                         'fastai_sequential')
        self.assertEqual(infer_publisher_layout(['conv1.weight', 'layer1.0.bn1.weight']),
                         'torchvision')
        with self.assertRaisesRegex(ValueError, 'mixed_publisher'):
            infer_publisher_layout(['0.0.weight', 'conv1.weight'])
        with self.assertRaisesRegex(ValueError, 'empty_publisher'):
            infer_publisher_layout([])
        with self.assertRaisesRegex(ValueError, 'unknown_publisher'):
            infer_publisher_layout(['model.other'])

    def test_probability_validation(self):
        scores = [0.] * len(CLASSES)
        scores[0] = .2
        scores[6] = .8
        out = validate_probabilities(scores)
        self.assertEqual(out['bdsm'], .2)
        self.assertAlmostEqual(sum(out.values()), 1)
        with self.assertRaisesRegex(ValueError, 'unexpected_red_desert'):
            validate_probabilities([1.0])
        with self.assertRaisesRegex(ValueError, 'invalid_probability_sum'):
            validate_probabilities([0.1] * len(CLASSES))

    def test_persisted_class_name_cache_round_trip(self):
        # The real research runner saves named score maps rather than arrays.
        scores = {category: 0.0 for category in CLASSES}
        scores['neutral'] = .75
        scores['bdsm'] = .25
        ordered_backwards = dict(reversed(list(scores.items())))
        self.assertEqual(validate_probabilities(ordered_backwards), scores)
        with tempfile.TemporaryDirectory() as dirname:
            path = Path(dirname) / 'scores.jsonl'
            sha = 'a' * 64
            row = {'sha256': sha, 'sourceGroup': 'one'}
            path.write_text(json.dumps({
                'sha256': sha, 'sourceGroup': 'one',
                'weightsSha256': FILE_SHA256,
                'scores': ordered_backwards,
            }) + '\n', encoding='utf-8')
            restored = read_cache(path, [row])
            self.assertEqual(restored[sha], scores)

    def test_rejects_incorrect_cached_labels_or_invalid_score_types(self):
        scores = {category: 0.0 for category in CLASSES}
        scores['neutral'] = 1.0
        with self.assertRaisesRegex(ValueError, 'unexpected_red_desert_output_dim'):
            validate_probabilities({k: v for k, v in scores.items() if k != 'x'})
        with self.assertRaisesRegex(ValueError, 'unexpected_red_desert_output_dim'):
            validate_probabilities({**scores, 'unverified': 0.0})
        with self.assertRaisesRegex(ValueError, 'invalid_probability'):
            validate_probabilities({**scores, 'neutral': True})
        with self.assertRaisesRegex(ValueError, 'invalid_probability_sum'):
            validate_probabilities({**scores, 'neutral': .4})

    def test_aggregate_is_private_and_does_not_reinterpret_undefined_classes(self):
        rows, predictions = [], {}
        sexual = ['none', 'suggestive', 'bdsm_kink', 'explicit_act']
        nudity = ['none', 'implied_nude', 'female_bare_breasts', 'genitalia']
        for i in range(20):
            sha = f'{i:064x}'
            rows.append({'sha256': sha, 'sourceGroup': 'source-' + str(i//2),
                         'sexualContext': sexual[i % 4],
                         'nudity': nudity[i % 4],
                         'imagePath': '/private/artes/image.jpg'})
            values = [0.02] * len(CLASSES)
            values[CLASSES.index('bdsm' if i%4==2 else 'neutral')] = .80
            predictions[sha] = validate_probabilities(values)
        report = aggregate(rows, predictions, 'a'*40)
        self.assertEqual(report['totalImages'], 20)
        self.assertEqual(report['bdsmTopClass']['bdsmImages'], 5)
        self.assertEqual(report['bdsmTopClass']['detectedAsTop'], 5)
        self.assertEqual(report['bdsmTopClass']['falseTopAmongOthers'], 0)
        self.assertEqual(report['modelWeightSha256'], FILE_SHA256)
        import json
        serialized = json.dumps(report)
        self.assertNotIn('/private/', serialized)
        for item in rows:
            self.assertNotIn(item['sha256'], serialized)


if __name__ == '__main__':
    unittest.main()
