import json
import tempfile
import unittest
from pathlib import Path

from compare_three_nsfw import (
    MODELS, REV_MINI, REV_LUKE, cache_records, safe_scores,
    statistics_for_model, report,
)

BASE = {'normal': .05, 'porn': .8, 'hentai': .05, 'drawing': .05, 'sexy': .05}
LOW = {'normal': .7, 'porn': .05, 'hentai': .05, 'drawing': .05, 'sexy': .15}


def rows():
    return [
        {'sha256': 'a'*64, 'sourceGroup': 'A', 'sexualContext': 'explicit_act',
         'nudity': 'genitalia'},
        {'sha256': 'b'*64, 'sourceGroup': 'B', 'sexualContext': 'none',
         'nudity': 'female_bare_breasts'},
    ]


def entry(sha, key, scores):
    model_id, revision, _ = MODELS[key]
    return {'sha256': sha, 'modelId': model_id, 'modelRevision': revision, 'scores': scores}


class ThreeModelTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.data = rows()

    def save(self, key, examples):
        filename = self.path / MODELS[key][2]
        filename.write_text(''.join(json.dumps(x) + '\n' for x in examples))
        return filename

    def test_scores_are_strict_and_normalized(self):
        self.assertEqual(safe_scores(BASE)['porn'], .8)
        for score in [dict(BASE, porn=1.3), dict(BASE, porn=float('nan')),
                      {'porn': 1}, dict(BASE, sexy=-1)]:
            with self.assertRaises(ValueError):
                safe_scores(score)

    def test_old_mini_cache_is_reused_without_modelid(self):
        old = [{'sha256': 'a'*64, 'modelRevision': REV_MINI, 'scores': BASE,
                'sexualContext': 'explicit_act', 'nudity': 'genitalia', 'sourceGroup': 'A'},
               {'sha256': 'b'*64, 'modelRevision': REV_MINI, 'scores': LOW,
                'sexualContext': 'none', 'nudity': 'female_bare_breasts', 'sourceGroup': 'B'}]
        path = self.save('mini', old)
        cache = cache_records(path, self.data, 'mini')
        self.assertEqual(len(cache), 2)
        summary = statistics_for_model(self.data, cache, 'mini')
        self.assertEqual(summary['descriptiveAtPornScore0_5']['explicitMissed'], 0)
        self.assertEqual(summary['descriptiveAtPornScore0_5']['nonExplicitNudityFlagged'], 0)

    def test_wrong_revision_does_not_look_successful(self):
        invalid = entry('a'*64, 'luke', BASE)
        invalid['modelRevision'] = REV_MINI
        path = self.save('luke', [invalid])
        with self.assertRaisesRegex(ValueError, 'incorrect_model_revision'):
            cache_records(path, self.data, 'luke')

    def test_partial_competitors_never_report_complete(self):
        self.save('mini', [
            {'sha256': 'a'*64, 'modelRevision': REV_MINI, 'scores': BASE},
            {'sha256': 'b'*64, 'modelRevision': REV_MINI, 'scores': LOW},
        ])
        self.save('luke', [entry('a'*64, 'luke', BASE)])
        result = report(self.data, self.path)
        self.assertFalse(result['comparisonComplete'])
        self.assertEqual(result['models']['luke']['scored'], 1)
        self.assertEqual(result['models']['gantman']['scored'], 0)
        self.assertEqual(result['historicalTestImagesUsed'], 0)
        exported = json.loads((self.path / 'nsfw-three-way-summary.json').read_text())
        self.assertNotIn('imagePath', str(exported))
        self.assertNotIn('sha256', str(exported))


if __name__ == '__main__':
    unittest.main()
