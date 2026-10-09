import json
import unittest

import numpy as np

from compare_luke_reddesert_fusion import (
    FEATURE_SETS, assemble, model_scores, make_model, study,
    validate_split, summarize_score,
)
from evaluate_reddesert_artes import CLASSES as RED_LABELS
from nsfw_shadow import MODEL_LABELS as LUKE_LABELS


class ContextualFusionTests(unittest.TestCase):
    @staticmethod
    def make_examples():
        rows, l_cache, r_cache = [], {}, {}
        rng = np.random.default_rng(1)
        contexts = ('none', 'suggestive', 'bdsm_kink', 'explicit_act')
        nudities = ('none', 'implied_nude', 'genitalia', 'female_bare_breasts')
        for source in range(16):
            for k in range(4):
                idx = source * 4 + k
                sha = f'{idx + 1:064x}'
                label = contexts[k]
                row = {
                    'sha256': sha, 'sourceGroup': f'group_{source}',
                    'sexualContext': label, 'nudity': nudities[k],
                    'resolvedPath': '/secret/artes-personal.jpg',
                }
                rows.append(row)
                l = {cat: .001 for cat in LUKE_LABELS}
                l['porn' if k == 3 else 'sexy' if k in (1, 2) else 'normal'] = .996
                rd = {cat: .001 for cat in RED_LABELS}
                rd['bdsm' if k == 2 else 'x' if k == 3 else 'sexy' if k == 1 else 'neutral'] = .99
                # Normalize, with tiny random perturbations to avoid constant features.
                for d in (l, rd):
                    total = sum(d.values())
                    for cat in d:
                        d[cat] /= total
                l_cache[sha] = {'scores': l}
                r_cache[sha] = rd
        return rows, l_cache, r_cache

    def test_assemble_exact_paired_scores(self):
        rows, luke, red = self.make_examples()
        x = assemble(rows, luke, red)
        self.assertEqual(x.shape, (64, len(LUKE_LABELS) + len(RED_LABELS)))
        with self.assertRaisesRegex(ValueError, 'full_375_photo_pairing_required'):
            assemble(rows, dict(list(luke.items())[:-1]), red)

    def test_group_leakage_is_rejected(self):
        groups = np.array(['A', 'A', 'B'])
        with self.assertRaisesRegex(ValueError, 'source_group_leakage'):
            validate_split([0], [1, 2], groups)
        validate_split([0, 1], [2], groups)

    def test_constant_training_fold_avoids_inventing_class(self):
        x = np.zeros((6, 5))
        fitted = make_model(x, np.zeros(6, dtype=int))
        self.assertEqual(model_scores(fitted, x).tolist(), [0.] * 6)

    def test_group_holdout_comparison_is_aggregate_only(self):
        rows, luke, red = self.make_examples()
        x = assemble(rows, luke, red)
        report, private = study(rows, x)
        self.assertEqual(report['images'], 64)
        self.assertEqual(report['sourceGroups'], 16)
        self.assertEqual(len(report['folds']), 4)
        self.assertEqual(set(report['models']), set(FEATURE_SETS))
        self.assertEqual(report['models']['combined_scores']['explicit_act']['positiveCount'], 16)
        self.assertEqual(report['models']['combined_scores']['bdsm_kink']['positiveCount'], 16)
        self.assertFalse(private['automatedModerationAllowed'])
        self.assertEqual(report['legacyRawLukeDevelopmentOnly']['originalCutoffCounts']['explicitDetected'], 16)
        output = json.dumps(report)
        self.assertNotIn('artes-personal.jpg', output)
        for row in rows:
            self.assertNotIn(row['sha256'], output)

    def test_threshold_summary_counts(self):
        rows, *_ = self.make_examples()
        label = [True, False, False, True] + [False] * 60
        pred = [.9, .7, .1, .15] + [0] * 60
        summary = summarize_score(label, pred, rows, explicit_axis=True)
        self.assertEqual(summary['threshold_0.5']['detectedPositives'], 1)
        self.assertEqual(summary['threshold_0.5']['incorrectlyFlaggedNegatives'], 1)
        self.assertEqual(summary['threshold_0.5']['missedPositives'], 1)


if __name__ == '__main__':
    unittest.main()
