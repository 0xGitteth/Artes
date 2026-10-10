import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from evaluate_independent_holdout import (
    cache_records, frozen_heads, predict_head, sealed_rows, summarize,
    FROZEN_THRESHOLD,
)
from nsfw_shadow import MODEL_LABELS as LUKE_LABELS
from evaluate_reddesert_artes import CLASSES as RED_LABELS
from compare_three_nsfw import REV_LUKE
from evaluate_reddesert_artes import FILE_SHA256 as RED_SHA


class IndependentHoldoutEvaluatorTests(unittest.TestCase):
    def test_uses_fixed_sigmoid_and_never_retrains_head(self):
        head = {'mean': [0.0, 0.0], 'scale': [1.0, 1.0],
                'coefficients': [5.0, -5.0], 'intercept': 0.0,
                'decisionClasses': [0, 1]}
        self.assertAlmostEqual(predict_head(head, [0.0, 0.0]), .5)
        self.assertGreater(predict_head(head, [1.0, 0.0]), 0.99)
        self.assertLess(predict_head(head, [0.0, 1.0]), 0.01)
        self.assertAlmostEqual(predict_head({'constant': 0.0}, [12]), 0.0)
        with self.assertRaisesRegex(ValueError, 'dimension_mismatch'):
            predict_head(head, [2.0])
        with self.assertRaisesRegex(ValueError, 'binary_head_label_order'):
            predict_head({**head, 'decisionClasses': [1, 0]}, [1.0, 0.0])

    def fake_predictions(self):
        contexts = ('none', 'explicit_act', 'none', 'explicit_act',
                    'suggestive', 'bdsm_kink', 'none', 'none')
        rows = []
        predictions = {}
        for i, context in enumerate(contexts):
            sha = f'{i+1:064x}'
            rows.append({
                'sha256': sha, 'sexualContext': context,
                'nudity': 'female_bare_breasts' if i in (0, 2) else 'none',
                'sourceGroup': f'new_group_{i}',
                'imagePath': 'images/fake.png',
            })
            luke = {c: 0.0 for c in LUKE_LABELS}
            red = {c: 0.0 for c in RED_LABELS}
            luke['porn' if context == 'explicit_act' else 'normal'] = 1.0
            red['x' if context == 'explicit_act' else 'neutral'] = 1.0
            predictions[sha] = {'luke': luke, 'redDesert': red}
        return rows, predictions

    def test_output_is_aggregate_only_and_frozen_threshold(self):
        rows, predictions = self.fake_predictions()
        model_heads = {}
        for name, size in [
            ('luke_scores', len(LUKE_LABELS)),
            ('red_desert_scores', len(RED_LABELS)),
            ('combined_scores', len(LUKE_LABELS) + len(RED_LABELS))
        ]:
            # Model trained on unrelated development data and never fitted here.
            model_heads[name] = {
                axis: {'mean': [0.0] * size, 'scale': [1.0] * size,
                       'coefficients': [0.0] * size, 'intercept': 0.0,
                       'decisionClasses': [0, 1]}
                for axis in ('explicit_act', 'bdsm_kink', 'suggestive')
            }
        result = summarize(rows, predictions, {'models': model_heads}, 'opaque_seal')
        self.assertEqual(result['images'], 8)
        self.assertFalse(result['approvedForAutomatedModeration'])
        self.assertEqual(result['explicitThresholdFrozenFromDevelopment'], FROZEN_THRESHOLD)
        self.assertEqual(result['modelComparisons']['combined_scores']['explicit_act']['detectedExplicit'], 2)
        self.assertEqual(result['modelComparisons']['combined_scores']['explicit_act']['flaggedNonExplicit'], 6)
        serialized = json.dumps(result)
        for row in rows:
            self.assertNotIn(row['sha256'], serialized)
            self.assertNotIn(row['sourceGroup'], serialized)
        self.assertNotIn('opaque_seal', serialized)

    def test_holdout_cache_rejects_other_seals_and_model_versions(self):
        rows, predicted = self.fake_predictions()
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder) / 'private.jsonl'
            sha = rows[0]['sha256']
            record = {
                'sha256': sha, 'sealSha256': 'sealed_before_scoring',
                'lukeRevision': REV_LUKE, 'redDesertWeightsSha256': RED_SHA,
                'luke': predicted[sha]['luke'], 'redDesert': predicted[sha]['redDesert'],
            }
            cache.write_text(json.dumps(record) + '\n')
            valid = cache_records(cache, rows, 'sealed_before_scoring')
            self.assertEqual(len(valid), 1)
            with self.assertRaisesRegex(ValueError, 'untrusted_or_mixed'):
                cache_records(cache, rows, 'different_seal')
            record['redDesertWeightsSha256'] = '0' * 64
            cache.write_text(json.dumps(record) + '\n')
            with self.assertRaisesRegex(ValueError, 'untrusted_or_mixed'):
                cache_records(cache, rows, 'sealed_before_scoring')


if __name__ == '__main__':
    unittest.main()
