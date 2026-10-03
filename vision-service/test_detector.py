import base64
import copy
import io
import hashlib
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import app
from detector import HEADS, LABEL_VERSION, infer_detector, validate_artifact
from train_detector import train, validate_dataset, metrics, wilson_lower

REVISION = 'a'*40
VECTOR = [1.0] + [0.0]*767


def artifact():
    return {'schemaVersion': 1, 'labelVersion': LABEL_VERSION, 'embeddingModelId': 'facebook/dinov2-base', 'embeddingRevision': REVISION, 'embeddingDimension': 768, 'modelVersion': 'fixture', 'datasetVersion': 'fixture-data', 'heads': {name: {'classes': values, 'weights': [[0.0]*768 for _ in values], 'bias': [12.0] + [0.0]*(len(values)-1)} for name,values in HEADS.items()}}


def label():
    return {'nudity': 'none', 'sexualContext': 'none', 'graphicInjury': 'none', 'possibleMinorConcern': False, 'sensitiveSignals': [], 'confidence': 1.0, 'uncertaintyFlags': []}


def item(index, split):
    key = f'{split}-{index}'
    return {'sourceExampleId': key, 'sourcePoolId': key, 'sourceFingerprintSha256': hashlib.sha256(key.encode()).hexdigest(), 'leakageGroupId': key, 'datasetSplit': split, 'datasetSplitFinal': True, 'trainingReady': True, 'candidate': True, 'curationStatus': 'approved', 'benchmarkOnly': False, 'trainingAsset': {'uri': 'gs://approved/' + key, 'approvedForTraining': True}, 'semanticEmbedding': {'semanticClusterId': key, 'semanticClusterApproved': True}, 'embeddingVector': VECTOR, 'detectorLabel': label()}


def dataset():
    return {'schemaVersion': 1, 'labelVersion': LABEL_VERSION, 'datasetVersion': 'synthetic-fixture', 'embedding': {'modelId': 'facebook/dinov2-base', 'dimension': 768, 'revision': REVISION}, 'items': [item(index, split) for split in ['train', 'validation', 'test'] for index in range(24)]}


class DetectorTests(unittest.TestCase):
    def test_full_contract_and_policy_free_output(self):
        model = validate_artifact(artifact(), 'facebook/dinov2-base', REVISION)
        result = infer_detector(model, VECTOR)
        self.assertEqual(result['detectorLabel']['nudity'], 'none')
        self.assertGreater(result['detectorLabel']['confidence'], .99)
        self.assertEqual(result['detectorLabel']['uncertaintyFlags'], [])
        self.assertNotIn('finalOutcome', result)

    def test_rejects_embedding_mismatch_nonfinite_weights_and_bad_shape(self):
        for mutation in ['revision', 'nan', 'shape']:
            model = artifact()
            if mutation == 'revision': model['embeddingRevision'] = 'wrong'
            if mutation == 'nan': model['heads']['nudity']['bias'][0] = float('nan')
            if mutation == 'shape': model['heads']['nudity']['weights'][0] = [0]
            with self.assertRaises(ValueError):
                validate_artifact(model, 'facebook/dinov2-base', REVISION)
        for vector in [[0]*768, [float('inf')]*768, [1]]:
            with self.assertRaises(ValueError): infer_detector(artifact(), vector)

    def test_missing_class_is_review_evidence(self):
        model = artifact()
        model['heads']['possibleMinorConcern'] = {'classes': [False], 'weights': [[0]*768], 'bias': [0]}
        validate_artifact(model, 'facebook/dinov2-base', REVISION)
        self.assertIn('incomplete_head_coverage:possibleMinorConcern', infer_detector(model, VECTOR)['detectorLabel']['uncertaintyFlags'])

    def test_outside_support_is_review_evidence(self):
        model = artifact()
        model['support'] = {'vectors': [VECTOR], 'minCosine': .8}
        validate_artifact(model, 'facebook/dinov2-base', REVISION)
        outside = [0.0, 1.0] + [0.0]*766
        self.assertIn('outside_calibrated_embedding_support', infer_detector(model, outside)['detectorLabel']['uncertaintyFlags'])


class DatasetTests(unittest.TestCase):
    def test_preserves_media_and_split_approval(self):
        self.assertEqual(validate_dataset(dataset())['train'], 24)
        mutations = [('researchOnly', True), ('trainingReady', False), ('benchmarkOnly', True), ('datasetSplitFinal', False)]
        for key,value in mutations:
            data = dataset(); data['items'][0][key] = value
            with self.assertRaises(ValueError): validate_dataset(data)
        for key in ['approvedForTraining', 'revoked', 'deleted']:
            data = dataset(); data['items'][0]['trainingAsset'][key] = key != 'approvedForTraining'
            with self.assertRaises(ValueError): validate_dataset(data)

    def test_source_cluster_hash_and_group_cannot_cross_splits(self):
        for key in ['sourcePoolId', 'sourceFingerprintSha256', 'leakageGroupId', 'semanticClusterId']:
            data = dataset(); left, right = data['items'][0], data['items'][24]
            if key == 'semanticClusterId': right['semanticEmbedding'][key] = left['semanticEmbedding'][key]
            else: right[key] = left[key]
            with self.assertRaisesRegex(ValueError, 'dataset_split_leakage'): validate_dataset(data)

    def test_correlated_images_count_as_one_failed_group(self):
        first, second = item(0, 'test'), item(1, 'test')
        second['leakageGroupId'] = first['leakageGroupId']
        wrong = label(); wrong['sexualContext'] = 'explicit_act'
        measured = metrics([(first, label()), (second, wrong)])
        self.assertEqual(measured['heldOutGroups'], 1)
        self.assertEqual(measured['precisionLowerBound'], 0)
        self.assertEqual(measured['criticalMisses'], 1)
        self.assertLess(wilson_lower(100, 100), .99)
        self.assertGreater(wilson_lower(400, 400), .99)

    def test_pipeline_trains_binary_heads_but_never_approves_small_incomplete_data(self):
        data = dataset()
        for index,row in enumerate(data['items']):
            vector = [0.0]*768
            vector[index%2] = 1.0
            row['embeddingVector'] = vector
            row['detectorLabel']['nudity'] = ['none', 'male_topless'][index%2]
        model, report, release = train(data)
        validate_artifact(model, 'facebook/dinov2-base', REVISION)
        self.assertEqual(model['heads']['nudity']['classes'], ['none', 'male_topless'])
        self.assertEqual(infer_detector(model, VECTOR)['detectorLabel']['nudity'], 'none')
        self.assertFalse(release['approved'])
        self.assertEqual(report['independentTest']['reviewRate'], 1)
        self.assertTrue(report['headCoverage']['possibleMinorConcern']['missing'])
        self.assertFalse(any(gate['validated'] for gate in release['classes'].values()))


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app.app)
        buffer = io.BytesIO(); Image.new('RGB', (2, 2)).save(buffer, format='PNG')
        self.request = {'contractVersion': 1, 'image': {'mimeType': 'image/png', 'base64': base64.b64encode(buffer.getvalue()).decode()}, 'requestedOutputs': ['embedding', 'detector']}

    def test_image_to_label_contract_without_model_download(self):
        with patch.object(app, 'embed_image', return_value=VECTOR), patch.object(app, 'configured_detector', return_value=artifact()):
            response = self.client.post('/v1/infer', json=self.request)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(len(result['embedding']['vector']), 768)
        self.assertEqual(result['detectorResult']['labelVersion'], LABEL_VERSION)
        self.assertNotIn('accessLevel', result['detectorResult'])

    def test_failure_missing_model_and_authentication(self):
        with patch.object(app, 'AUTH_TOKEN', 'test-secret'), patch.object(app, 'embed_image') as embed:
            self.assertEqual(self.client.post('/v1/infer', json=self.request).status_code, 401)
            embed.assert_not_called()
        with patch.object(app, 'AUTH_TOKEN', 'test-secret'), patch.object(app, 'embed_image', return_value=VECTOR), patch.object(app, 'configured_detector', return_value=None):
            response = self.client.post('/v1/infer', json=self.request, headers={'Authorization': 'Bearer test-secret'})
            self.assertEqual(response.status_code, 200)
            self.assertIsNone(response.json()['detectorResult'])
        with patch.object(app, 'embed_image', side_effect=RuntimeError('test-only')):
            with self.assertLogs('artes.vision', level='ERROR'):
                self.assertEqual(self.client.post('/v1/infer', json=self.request).status_code, 503)

    def test_invalid_media_and_contract(self):
        bad = copy.deepcopy(self.request); bad['image']['base64'] = 'not-base64'
        self.assertEqual(self.client.post('/v1/infer', json=bad).status_code, 400)
        bad = copy.deepcopy(self.request); bad['contractVersion'] = 2
        self.assertEqual(self.client.post('/v1/infer', json=bad).status_code, 400)

    def test_installed_detector_warms_before_requests_and_invalid_artifact_fails_startup(self):
        with patch.object(app, 'DETECTOR_PATH', 'fixture.json'), patch.object(app, 'configured_detector', return_value=artifact()) as detector, patch.object(app, 'load_model') as model:
            with TestClient(app.app):
                detector.assert_called_once()
                model.assert_called_once()
        with patch.object(app, 'DETECTOR_PATH', 'invalid.json'), patch.object(app, 'configured_detector', side_effect=ValueError('invalid-artifact')):
            with self.assertRaises(ValueError):
                with TestClient(app.app): pass


if __name__ == '__main__':
    unittest.main()
