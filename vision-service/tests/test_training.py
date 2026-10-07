import copy
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

from linear_heads import build_head_result, predict_heads, validate_artifact
from reviewed_dataset import HEAD_CLASSES, LABEL_DEFINITION, file_sha256, load_reviewed_dataset, validate_training_clearance
from train_classifier import make_group_folds, train_heads


def artifact_fixture():
    rng = np.random.default_rng(42)
    artifact = {
        'schemaVersion': 1, 'artifactType': 'artes_supervised_linear_heads',
        'scope': 'offline_research_probe', 'runtimeEligible': False, 'productionEligible': False,
        'labelDefinitionVersion': LABEL_DEFINITION, 'modelVersion': 'test', 'datasetVersion': 'test',
        'featureDefinition': {'modelId': 'facebook/dinov2-base', 'revision': 'a' * 40,
                              'dimension': 768, 'pooling': 'cls_last_hidden_state',
                              'normalization': 'l2', 'processorSha256': 'b' * 64}, 'heads': {},
    }
    x = rng.normal(size=(56, 768))
    x /= np.linalg.norm(x, axis=1, keepdims=True)
    fitted = {}
    for name, labels in HEAD_CLASSES.items():
        y = np.asarray([labels[i % len(labels)] for i in range(len(x))])
        model = LogisticRegression(C=1, class_weight='balanced', max_iter=1000).fit(x, y)
        artifact['heads'][name] = {'classes': model.classes_.tolist(), 'coefficients': model.coef_.tolist(),
                                  'intercepts': model.intercept_.tolist()}
        fitted[name] = model
    return artifact, x, fitted


class ClassifierTests(unittest.TestCase):
    def setUp(self):
        self.artifact, self.x, self.models = artifact_fixture()

    def test_export_matches_fitted_sklearn_probabilities(self):
        # Software round trip only: synthetic vectors are not photo accuracy.
        artifact = json.loads(json.dumps(self.artifact))
        validate_artifact(artifact, artifact['featureDefinition'])
        actual = predict_heads(artifact, self.x[:3])
        for name, model in self.models.items():
            expected = model.predict_proba(self.x[:3])
            for output, probabilities in zip(actual, expected):
                np.testing.assert_allclose(list(output[name]['probabilities'].values()), probabilities, atol=1e-12)

    def test_backbone_revision_mismatch_rejected(self):
        features = dict(self.artifact['featureDefinition'], revision='other')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            validate_artifact(self.artifact, features)

    def test_nonfinite_weights_rejected(self):
        self.artifact['heads']['nudity']['coefficients'][0][0] = float('nan')
        with self.assertRaisesRegex(ValueError, 'weights'):
            validate_artifact(self.artifact)

    def test_wrong_classes_and_duplicate_classes_rejected(self):
        self.artifact['heads']['sexualContext']['classes'][0] = 'other'
        with self.assertRaisesRegex(ValueError, 'classes'):
            validate_artifact(self.artifact)

    def test_unnormalized_input_rejected(self):
        with self.assertRaisesRegex(ValueError, 'normalized'):
            predict_heads(self.artifact, self.x[0] * 2)

    def test_partial_heads_do_not_fabricate_full_safety_labels(self):
        result = build_head_result(self.artifact, predict_heads(self.artifact, self.x[0])[0])
        self.assertIn('possibleMinorConcern', result['unassessedFields'])
        self.assertFalse(result['runtimeEligible'])
        self.assertNotIn('detectorLabel', result)

    def test_grouped_folds_never_mix_makers(self):
        rows = [{'candidateId': str(i), 'nudity': HEAD_CLASSES['nudity'][i % 7],
                 'sourcePoolId': f'maker-{i // 7}'} for i in range(140)]
        seen = []
        for train, validation in make_group_folds(rows, 'nudity', folds=5):
            self.assertFalse({rows[i]['sourcePoolId'] for i in train} & {rows[i]['sourcePoolId'] for i in validation})
            seen.extend(validation.tolist())
        self.assertEqual(sorted(seen), list(range(140)))

    def test_complete_two_head_training_exports_readable_numeric_weights(self):
        rows = [{'candidateId': str(i), 'nudity': HEAD_CLASSES['nudity'][i % 7],
                 'sexualContext': HEAD_CLASSES['sexualContext'][i % 4],
                 'sourcePoolId': f'maker-{i // 7}'} for i in range(140)]
        rng = np.random.default_rng(43)
        x = rng.normal(size=(140, 768))
        x /= np.linalg.norm(x, axis=1, keepdims=True)
        heads, reports, predictions = train_heads(rows, x, folds=5)
        artifact = copy.deepcopy(self.artifact)
        artifact['heads'] = heads
        validate_artifact(artifact)
        self.assertEqual(len(predictions), 140)
        self.assertEqual(set(reports), {'nudity', 'sexualContext'})
        self.assertEqual(set(predict_heads(artifact, x[0])[0]), {'nudity', 'sexualContext'})


class DatasetTests(unittest.TestCase):
    def test_test_files_are_not_read_by_training_loader_and_group_leak_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'train.jpg').write_bytes(b'training')
            (root / 'evidence.json').write_text('{}')
            row = {'candidateId': 'train', 'labelStatus': 'human_confirmed', 'humanLabelConfirmed': True,
                   'includedInReviewedResearchDataset': True, 'needsManualReview': False,
                   'humanReviewConfirmedAt': 'date', 'humanReviewExportSha256': 'export',
                   'labelDefinitionVersion': LABEL_DEFINITION, 'nudity': 'none', 'sexualContext': 'none',
                   'detectorLabel': {'nudity': 'none', 'sexualContext': 'none'},
                   'proposedSplit': 'train', 'sourcePoolId': 'maker1', 'shootGroupId': 'shoot1',
                   'localPath': 'train.jpg', 'sha256': file_sha256(root / 'train.jpg'),
                   'finalSourceEvidencePath': 'evidence.json', 'finalSourceEvidenceSha256': file_sha256(root / 'evidence.json')}
            heldout = dict(row, candidateId='test', proposedSplit='test', sourcePoolId='maker2',
                           shootGroupId='shoot2', localPath='missing-test.jpg', sha256='heldout-hash')
            dataset = {'schemaVersion': 4, 'humanLabelsAuthoritative': True, 'datasetVersion': 'test',
                       'labelDefinitionVersion': LABEL_DEFINITION, 'items': [row, heldout]}
            path = root / 'dataset.json'
            path.write_text(json.dumps(dataset))
            loaded = load_reviewed_dataset(path)
            self.assertEqual([r['candidateId'] for r in loaded['rows']], ['train'])
            heldout['shootGroupId'] = 'shoot1'
            path.write_text(json.dumps(dataset))
            with self.assertRaisesRegex(ValueError, 'heldout_group_leakage'):
                load_reviewed_dataset(path)

    def test_content_confirmation_is_not_training_clearance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.json'
            path.write_text(json.dumps({'schemaVersion': 1, 'scope': 'offline_research_probe',
                'datasetSha256': 'dataset', 'labelDefinitionVersion': LABEL_DEFINITION,
                'executionScope': 'existing_workspace',
                'runtimeEligible': False, 'productionEligible': False,
                'assessmentEvidence': 'assessment', 'items': []}))
            loaded = {'datasetSha256': 'dataset', 'rows': [{'candidateId': 'one', 'sha256': 'image',
                       'finalSourceEvidenceSha256': 'source', 'humanLabelConfirmed': True}]}
            with self.assertRaisesRegex(ValueError, 'training_use_not_cleared'):
                validate_training_clearance(loaded, path)

    def test_local_use_assessment_does_not_authorize_external_training(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.json'
            path.write_text(json.dumps({'schemaVersion': 1, 'scope': 'offline_research_probe',
                'datasetSha256': 'dataset', 'labelDefinitionVersion': LABEL_DEFINITION,
                'executionScope': 'existing_workspace', 'runtimeEligible': False, 'productionEligible': False,
                'assessmentEvidence': 'local only', 'items': []}))
            with self.assertRaisesRegex(ValueError, 'invalid_training_use_assessment'):
                validate_training_clearance({'datasetSha256': 'dataset', 'rows': []}, path, 'artes_temporary_compute')


if __name__ == '__main__':
    unittest.main()
