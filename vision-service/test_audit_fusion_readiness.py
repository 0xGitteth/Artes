import copy
import unittest

from audit_fusion_readiness import audit, wilson_lower


def fixture():
    models = {}
    for name, alarms in [
        ('luke_scores', [87, 68, 64, 54]),
        ('red_desert_scores', [158, 135, 106, 22]),
        ('combined_scores', [88, 57, 40, 28]),
    ]:
        tp = [40, 39, 39, 36] if name == 'luke_scores' else (
            [39, 37, 37, 19] if name == 'red_desert_scores' else [41, 41, 38, 35])
        nudity = [53, 42, 40, 36] if name == 'luke_scores' else (
            [81, 71, 62, 18] if name == 'red_desert_scores' else [57, 33, 23, 19])
        axis = {'auc': 0.94, 'averagePrecision': 0.55,
                'positiveCount': 41, 'negativeCount': 334}
        for i, threshold in enumerate(('0.1', '0.25', '0.5', '0.75')):
            axis['threshold_' + threshold] = {
                'detectedPositives': tp[i],
                'missedPositives': 41 - tp[i],
                'incorrectlyFlaggedNegatives': alarms[i],
                'correctlyPassedNegatives': 334 - alarms[i],
                'incorrectlyFlaggedAllowedNudes': nudity[i],
            }
        models[name] = {'explicit_act': axis}
    return {
        'status': 'supervised_development_comparison_not_release_validation',
        'images': 375, 'sourceGroups': 103,
        'humanLabels': {'explicit_act': 41, 'bdsm_kink': 10, 'suggestive': 93},
        'models': models,
        'legacyRawLukeDevelopmentOnly': {'originalCutoffCounts': {
            'explicitDetected': 41, 'nonExplicitFlagged': 78,
            'allowedNudesFlagged': 48,
        }},
    }


class ResearchReadinessTests(unittest.TestCase):
    def test_perfect_development_recall_is_not_release_ready(self):
        result = audit(fixture())
        self.assertFalse(result['releaseApproval']['approved'])
        self.assertFalse(result['sourceSample']['independentUntouchedHoldout'])
        best = result['illustrativeCombinedAtQuarter']
        self.assertEqual(best['detectedExplicit'], 41)
        self.assertEqual(best['missedExplicit'], 0)
        self.assertEqual(best['totalFlaggedForPotentialReview'], 98)
        self.assertEqual(best['flaggedNonExplicit'], 57)
        self.assertEqual(best['flaggedAllowedArtNude'], 33)
        self.assertLess(best['explicitRecallTwoSided95WilsonLower'], 0.99)
        self.assertLess(best['flaggedPrecisionTwoSided95WilsonLower'], 0.99)

    def test_all_candidates_reported_and_no_secret_paths(self):
        import json
        f = fixture()
        f['privateFilePath'] = '/secret/person/photo.jpg'
        r = audit(f)
        self.assertEqual(set(r['researchScreeningComparisons']),
                         {'luke_scores', 'red_desert_scores', 'combined_scores'})
        self.assertNotIn('/secret/', json.dumps(r))
        self.assertEqual(r['historicalRawLukeCutoff']['flaggedNonExplicit'], 78)

    def test_inconsistent_counts_rejected(self):
        f = fixture()
        f['models']['combined_scores']['explicit_act']['threshold_0.25']['detectedPositives'] = 40
        with self.assertRaisesRegex(ValueError, 'explicit_count_mismatch'):
            audit(f)

    def test_wilson_bounds_cannot_claim_full_safety_from_41(self):
        self.assertAlmostEqual(wilson_lower(41, 41), 0.9143, places=3)
        self.assertEqual(wilson_lower(0, 0), None)
        with self.assertRaisesRegex(ValueError, 'invalid_binomial'):
            wilson_lower(2, 1)


if __name__ == '__main__':
    unittest.main()
