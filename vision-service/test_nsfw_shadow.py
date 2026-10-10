import base64
import io
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import app
from nsfw_shadow import MODEL_LABELS, format_nsfw_scores, validate_revision

REVISION = 'b' * 40


class NsfwModelContractTests(unittest.TestCase):
    def test_revision_is_pinned_to_full_commit_sha(self):
        self.assertEqual(validate_revision(REVISION), REVISION)
        for revision in ('main', None, '', 'abc123', 'z' * 40):
            with self.assertRaises(ValueError):
                validate_revision(revision)

    def test_raw_model_categories_are_diagnostic_not_explicit_sexual_acts(self):
        scores = {
            'normal': .02, 'porn': .55, 'hentai': .03,
            'drawing': .04, 'sexy': .36,
        }
        result = format_nsfw_scores(scores, REVISION)
        self.assertEqual(result['providerId'], 'nsfw')
        self.assertEqual(result['modelVersion'], REVISION)
        self.assertTrue(result['uncertain'])
        self.assertEqual(len(result['signals']), len(MODEL_LABELS))
        self.assertEqual(result['signals'][1], {
            'type': 'nsfw_porn_category', 'confidence': .55,
        })
        self.assertNotIn('sexual_explicit', str(result))
        for policy_field in ('finalOutcome', 'policyDecision', 'accessLevel', 'shouldReview'):
            self.assertNotIn(policy_field, result)

    def test_invalid_label_coverage_or_probability_rejected(self):
        base = {key: .2 for key in MODEL_LABELS}
        cases = [
            dict(base, porn=float('nan')),
            dict(base, porn=1.1),
            dict(base, porn='0.2'),
            {k: v for k, v in base.items() if k != 'porn'},
            dict(base, porn=.6),
        ]
        for case in cases:
            with self.subTest(case=case):
                with self.assertRaises(ValueError):
                    format_nsfw_scores(case, REVISION)


class NsfwShadowApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app.app)
        buffer = io.BytesIO()
        Image.new('RGB', (2, 2)).save(buffer, format='PNG')
        self.body = {
            'contractVersion': 1,
            'image': {
                'mimeType': 'image/png',
                'base64': base64.b64encode(buffer.getvalue()).decode(),
            },
            'requestedOutputs': ['signals'],
        }

    def test_unconfigured_route_is_not_available(self):
        with patch.object(app, 'NSFW_SHADOW_ENABLED', False), patch.object(app, 'classify_nsfw') as run:
            self.assertEqual(self.client.post('/v1/signals', json=self.body).status_code, 404)
            run.assert_not_called()

    def test_missing_token_configuration_blocks_all_calls(self):
        with patch.object(app, 'NSFW_SHADOW_ENABLED', True), patch.object(app, 'NSFW_SHADOW_TOKEN', None), patch.object(app, 'classify_nsfw') as run:
            self.assertEqual(self.client.post('/v1/signals', json=self.body).status_code, 503)
            run.assert_not_called()

    def test_wrong_token_and_unpinned_model_revision_fail_closed(self):
        with patch.object(app, 'NSFW_SHADOW_ENABLED', True), patch.object(app, 'NSFW_SHADOW_TOKEN', 'secret'), patch.object(app, 'NSFW_MODEL_REVISION', REVISION), patch.object(app, 'classify_nsfw') as run:
            self.assertEqual(self.client.post('/v1/signals', json=self.body).status_code, 401)
            run.assert_not_called()
        with patch.object(app, 'NSFW_SHADOW_ENABLED', True), patch.object(app, 'NSFW_SHADOW_TOKEN', 'secret'), patch.object(app, 'NSFW_MODEL_REVISION', 'main'), patch.object(app, 'classify_nsfw') as run:
            self.assertEqual(self.client.post('/v1/signals', json=self.body, headers={'Authorization': 'Bearer secret'}).status_code, 503)
            run.assert_not_called()

    def test_successful_synthetic_request_does_not_return_policy(self):
        scores = {key: .2 for key in MODEL_LABELS}
        expected = format_nsfw_scores(scores, REVISION)
        with patch.object(app, 'NSFW_SHADOW_ENABLED', True), patch.object(app, 'NSFW_SHADOW_TOKEN', 'secret'), patch.object(app, 'NSFW_MODEL_REVISION', REVISION), patch.object(app, 'classify_nsfw', return_value=expected) as run:
            response = self.client.post('/v1/signals', json=self.body, headers={'Authorization': 'Bearer secret'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), expected)
            run.assert_called_once()

    def test_rejects_invalid_contract_and_media_before_inference(self):
        with patch.object(app, 'NSFW_SHADOW_ENABLED', True), patch.object(app, 'NSFW_SHADOW_TOKEN', 'secret'), patch.object(app, 'NSFW_MODEL_REVISION', REVISION), patch.object(app, 'classify_nsfw') as run:
            bad = {**self.body, 'requestedOutputs': ['embedding']}
            response = self.client.post('/v1/signals', json=bad, headers={'Authorization': 'Bearer secret'})
            self.assertEqual(response.status_code, 400)
            bad = {**self.body, 'image': {'mimeType': 'image/png', 'base64': 'bad!'}}
            self.assertEqual(self.client.post('/v1/signals', json=bad, headers={'Authorization': 'Bearer secret'}).status_code, 400)
            run.assert_not_called()

    def test_inference_failure_sanitizes_response(self):
        with patch.object(app, 'NSFW_SHADOW_ENABLED', True), patch.object(app, 'NSFW_SHADOW_TOKEN', 'secret'), patch.object(app, 'NSFW_MODEL_REVISION', REVISION), patch.object(app, 'classify_nsfw', side_effect=RuntimeError('do not expose private model path')):
            response = self.client.post('/v1/signals', json=self.body, headers={'Authorization': 'Bearer secret'})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {'detail': 'shadow_model_unavailable'})
            self.assertNotIn('private model', response.text)


if __name__ == '__main__':
    unittest.main()
