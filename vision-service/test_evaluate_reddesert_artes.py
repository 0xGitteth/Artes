import unittest

from evaluate_reddesert_artes import (
    CLASSES, FILE_SHA256, aggregate, validate_probabilities,
)


class RedDesertArtesTests(unittest.TestCase):
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
