import unittest

from compare_nsfw_thresholds import (
    candidate_at_threshold, matched_recall, build_report,
)
from compare_three_nsfw import MODELS

def row(key, context, nudity):
    return {
        'sha256': key * 64, 'sourceGroup': key,
        'sexualContext': context, 'nudity': nudity,
    }


ROWS = [
    row('a', 'explicit_act', 'genitalia'),
    row('b', 'explicit_act', 'genitalia'),
    row('c', 'explicit_act', 'genitalia'),
    row('d', 'suggestive', 'female_bare_breasts'),
    row('e', 'none', 'none'),
]
PORNS = {'a': .9, 'b': .7, 'c': .3, 'd': .65, 'e': .1}


def predictions(porn_by_id=PORNS):
    return {
        key * 64: {
            'scores': {
                'normal': 1.0 - score,
                'porn': score,
                'hentai': 0.0,
                'drawing': 0.0,
                'sexy': 0.0,
            }
        } for key, score in porn_by_id.items()
    }


class ThresholdComparisonTests(unittest.TestCase):
    def test_at_half_catches_two_and_one_nude_false_alarm(self):
        result = candidate_at_threshold(ROWS, predictions(), .5)
        self.assertEqual(result['explicitSignaled'], 2)
        self.assertEqual(result['explicitMissed'], 1)
        self.assertEqual(result['nonExplicitSignaled'], 1)
        self.assertEqual(result['nonExplicitNuditySignaled'], 1)
        self.assertEqual(result['totalSignaled'], 3)

    def test_strict_recall_observes_more_false_alarms(self):
        result = matched_recall(ROWS, predictions(), 3)
        self.assertEqual(result['threshold'], .3)
        self.assertEqual(result['explicitMissed'], 0)
        self.assertEqual(result['nonExplicitSignaled'], 1)

    def test_one_fewer_positive_raises_threshold(self):
        result = matched_recall(ROWS, predictions(), 2)
        self.assertEqual(result['threshold'], .7)
        self.assertEqual(result['explicitSignaled'], 2)
        self.assertEqual(result['nonExplicitSignaled'], 0)

    def test_equal_score_ties_never_miss_requested_recall(self):
        scores = {'a': .8, 'b': .8, 'c': .3, 'd': .3, 'e': .1}
        result = matched_recall(ROWS, predictions(scores), 1)
        self.assertEqual(result['explicitSignaled'], 2)
        self.assertEqual(result['explicitMissed'], 1)
        self.assertEqual(result['nonExplicitSignaled'], 0)

    def test_incomplete_model_cache_is_rejected(self):
        cache = predictions()
        bad = cache.copy()
        bad.pop('a' * 64)
        all_caches = {name: cache for name in MODELS}
        all_caches['luke'] = bad
        with self.assertRaisesRegex(ValueError, 'incomplete_or_mismatched_scores'):
            build_report(ROWS, all_caches)

    def test_summary_has_only_aggregates_and_disclaims_tuning(self):
        cache = predictions()
        result = build_report(ROWS, {name: cache for name in MODELS})
        self.assertEqual(result['historicalTestImagesUsed'], 0)
        self.assertEqual(result['developmentGroups'], 5)
        self.assertTrue(any('chosen from the same development' in msg for msg in result['notes']))
        self.assertNotIn('sha256', str(result))
        self.assertEqual(
            result['models']['mini']['minimumRecallTargets']['3_of_3']['explicitMissed'], 0
        )

    def test_invalid_threshold_rejected(self):
        for value in [float('nan'), -0.1, 1.1]:
            with self.assertRaises(ValueError):
                candidate_at_threshold(ROWS, predictions(), value)


if __name__ == '__main__':
    unittest.main()
