import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from train_luke_artes import (MODEL_ID, REVISION, FEATURE_DIM, SEXUAL_CLASSES,
    load_features, fit, predict, json_head, evaluate)


class ArtesLukeContextTests(unittest.TestCase):
    def test_private_feature_cache_rejects_duplicate_or_unrecognized_revision(self):
        record = {'sha256': 'a' * 64, 'modelRevision': REVISION,
                  'sourceGroup': 'one', 'embedding': [1.] + [0.] * (FEATURE_DIM - 1)}
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / 'features.jsonl'
            file.write_text(json.dumps(record) + '\n')
            rows = [{'sha256': record['sha256'], 'sourceGroup': 'one'}]
            self.assertEqual(len(load_features(file, rows)), 1)
            file.write_text(json.dumps(record) + '\n' + json.dumps(record) + '\n')
            with self.assertRaises(ValueError):
                load_features(file, rows)
            record['embedding'] = [0.] * FEATURE_DIM
            file.write_text(json.dumps(record) + '\n')
            with self.assertRaises(ValueError):
                load_features(file, rows)

    def test_trainable_head_stores_only_json_weights(self):
        rng = np.random.default_rng(42)
        x = rng.normal(size=(24, FEATURE_DIM)).astype('float32')
        x[12:] += 3
        labels = ['none'] * 12 + ['explicit_act'] * 12
        model = fit(x, labels)
        predicted = predict(model, x)
        self.assertGreaterEqual(sum(a == b for a, b in zip(labels, predicted)), 22)
        artifact = json_head(model)
        self.assertIn('coefficients', artifact)
        self.assertIn('pcaComponents', artifact)
        json.dumps(artifact)

    def test_single_class_does_not_invent_sexual_category(self):
        x = np.zeros((8, FEATURE_DIM), dtype='float32')
        model = fit(x, ['none'] * 8)
        self.assertEqual(predict(model, x), ['none'] * 8)
        self.assertEqual(json_head(model), {'constant': 'none'})

    def test_source_group_holdout_aggregate_has_no_fingerprints_or_paths(self):
        rng = np.random.default_rng(42)
        combos = [('none', 'none'), ('suggestive', 'underwear_swimwear'),
                  ('bdsm_kink', 'none'), ('explicit_act', 'genitalia'),
                  ('none', 'implied_nude'), ('none', 'female_bare_breasts')]
        rows, feats, baseline = [], {}, {}
        for i in range(48):
            context, nudity = combos[i % len(combos)]
            sha = f'{i:064x}'
            rows.append({'sha256': sha, 'sourceGroup': f'src_{i // 2}',
                         'sexualContext': context, 'nudity': nudity,
                         'imagePath': f'/private/{i}.jpg'})
            vector = rng.normal(size=FEATURE_DIM).astype('float32')
            vector[i % len(combos)] += 4
            feats[sha] = vector / np.linalg.norm(vector)
            baseline[sha] = {'scores': {'porn': .4 if context == 'explicit_act' else .1}}
        report = evaluate(rows, feats, baseline)
        self.assertEqual(report['images'], 48)
        self.assertEqual(report['sourceGroups'], 24)
        self.assertEqual(report['explicitActScreening']['lukeArtesOOF']['explicitTotal'], 8)
        self.assertEqual(set(report['axes']), {'sexualContext', 'nudity', 'explicitAct'})
        for row in rows:
            self.assertNotIn(row['sha256'], json.dumps(report))
        self.assertNotIn('/private/', json.dumps(report))


if __name__ == '__main__':
    unittest.main()
