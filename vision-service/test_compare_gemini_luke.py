import json
import tempfile
import unittest
from pathlib import Path

from compare_gemini_luke import gemini_cache, samples, summarize

def row(key, context, nudity='none'):
    return {'sha256': key * 64, 'sourceGroup': key, 'sexualContext': context, 'nudity': nudity}

ROWS = [
    row('a', 'explicit_act', 'genitalia'),
    row('b', 'explicit_act', 'genitalia'),
    row('c', 'none', 'female_bare_breasts'),
    row('d', 'suggestive', 'implied_nude'),
    row('e', 'none'),
    row('f', 'none'),
    row('1', 'none'),
    row('2', 'none'),
    row('3', 'none'),
    row('4', 'none'),
    row('5', 'none'),
    row('6', 'none'),
]

def luke_scores():
    porn = {'a': 0.9, 'b': 0.3, 'c': 0.6, 'd': 0.1, 'e': 0.02}
    return {r['sha256']: {'scores': {'porn': porn.get(r['sha256'][0], 0.05)}} for r in ROWS}

def gem(sha, status='ok', adult='explicit', uncertain=False):
    return {
        'sha256': sha, 'modelVersion': 'gemini-2.5-flash',
        'promptVersion': 'gemini_moderation_v2',
        'status': status,
        'adultDecision': adult if status == 'ok' else None,
        'sexualExplicitUncertain': uncertain,
    }

class GeminiLukeCompareTests(unittest.TestCase):
    def test_preview_sample_is_deterministic_and_bounded(self):
        picked = samples(ROWS, 12)
        self.assertEqual(len(picked), 12)
        self.assertEqual(len({r['sha256'] for r in picked}), 12)
        self.assertEqual(sum(r['sexualContext'] == 'explicit_act' for r in picked), 2)
        with self.assertRaises(ValueError):
            samples(ROWS, 0)

    def test_unavailable_gemini_is_not_counted_as_a_wrong_classification(self):
        predictions = {ROWS[0]['sha256']: gem(ROWS[0]['sha256']),
                       ROWS[1]['sha256']: gem(ROWS[1]['sha256'], 'safety_blocked')}
        output = summarize(ROWS, luke_scores(), predictions, ROWS)
        self.assertEqual(output['imagesWithGeminiOutput'], 2)
        self.assertEqual(output['imagesWithValidGeminiDecision'], 1)
        self.assertEqual(output['geminiExplicitDecisionsOnValidPairedImages']['explicitFlagged'], 1)
        self.assertEqual(output['geminiEscalationsOrUnavailable']['explicitLabeled'], 1)
        self.assertEqual(output['lukeOnSameGeminiValidImages']['explicitFlagged'], 1)
        self.assertEqual(output['pairedOpinionDisagreementsWhereGeminiValid'], 0)

    def test_matched_disagreement_is_reported_without_identifiers(self):
        examples = {ROWS[0]['sha256']: gem(ROWS[0]['sha256'], 'ok', 'none')}
        output = summarize(ROWS, luke_scores(), examples, ROWS)
        self.assertEqual(output['pairedOpinionDisagreementsWhereGeminiValid'], 1)
        self.assertNotIn(ROWS[0]['sha256'], str(output))
        self.assertNotIn('imagePath', str(output))

    def test_cache_rejects_unknown_and_duplicate_images(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'stored.jsonl'
            filename.write_text(json.dumps(gem(ROWS[0]['sha256'])) + '\n')
            self.assertEqual(len(gemini_cache(filename, ROWS)), 1)
            filename.write_text(json.dumps(gem(ROWS[0]['sha256'])) + '\n' +
                                json.dumps(gem(ROWS[0]['sha256'])) + '\n')
            with self.assertRaises(ValueError):
                gemini_cache(filename, ROWS)
            filename.write_text(json.dumps(gem('z'*64)) + '\n')
            with self.assertRaises(ValueError):
                gemini_cache(filename, ROWS)

    def test_missing_luke_predictions_never_silently_become_negatives(self):
        with self.assertRaises(ValueError):
            summarize(ROWS, {}, {}, ROWS)


if __name__ == '__main__':
    unittest.main()
