import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthorizedLabelTemplate,
  buildAuthorizedTestSetItem,
  normalizeAuthorizedTestImageName,
} from '../moderationAuthorizedTestSet.js';

const validLabel = {
  nudity: 'none',
  sexualContext: 'none',
  graphicInjury: 'none',
  sensitiveSignals: [],
  possibleMinorConcern: false,
  confidence: 1,
  uncertaintyFlags: [],
};

const embedding = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);

test('authorized test-set contract permits supported local image names only', () => {
  assert.equal(normalizeAuthorizedTestImageName('/tmp/example.JPG'), 'example.JPG');
  assert.equal(normalizeAuthorizedTestImageName('x.txt'), null);
});

test('authorized test-set item requires explicit local POC authorization', () => {
  assert.throws(() => buildAuthorizedTestSetItem({
    fileName: 'test.png',
    buffer: Buffer.from('image'),
    embedding,
    detectorLabel: validLabel,
  }), /authorized_test_image_permission_required/);
});

test('authorized test-set item is ready only with embedding and complete human label', () => {
  const item = buildAuthorizedTestSetItem({
    fileName: 'test.png',
    buffer: Buffer.from('image'),
    embedding,
    detectorLabel: validLabel,
    authorizedForLocalPoc: true,
  });
  assert.equal(item.embeddingReady, true);
  assert.equal(item.labelReady, true);
  assert.equal(item.trainingCandidateReady, true);
  assert.equal(item.embedding.dimension, 768);
  assert.equal(item.detectorLabel.nudity, 'none');
});

test('authorized test-set item never invents a missing detector label', () => {
  const item = buildAuthorizedTestSetItem({
    fileName: 'test.webp',
    buffer: Buffer.from('image'),
    embedding,
    authorizedForLocalPoc: true,
  });
  assert.equal(item.labelReady, false);
  assert.equal(item.detectorLabel, null);
  assert.equal(item.trainingCandidateReady, false);
  assert.deepEqual(item.labelErrors, ['missing_detector_label']);
});

test('label template is explicitly pending human labeling', () => {
  const template = buildAuthorizedLabelTemplate({ fileName: 'test.jpg', sha256: 'abc' });
  assert.equal(template.labelStatus, 'pending_human_label');
  assert.equal(template.detectorLabel.nudity, null);
  assert.equal(template.detectorLabel.possibleMinorConcern, null);
});
