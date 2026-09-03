import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessExternalImageTrainingEligibility,
  assertExternalImageTrainingEligible,
} from '../moderationExternalImageEligibility.js';

const verifiedAdultSelfSubject = {
  sourcePlatform: 'flickr',
  copyrightLicenseVerified: true,
  rightsStatus: 'cc_by_2_0',
  explicitAiTrainingPermission: true,
  recognizableHuman: true,
  adultStatus: 'verified_over_21_by_source',
  modelRightsStatus: 'creator_subject_owned',
  sourceIsOriginalCreatorLocation: true,
};

test('fully verified creator-owned Flickr subject can pass the research gate', () => {
  const result = assessExternalImageTrainingEligibility(verifiedAdultSelfSubject);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
});

test('recognizable human fails closed when adulthood or model rights are pending', () => {
  const result = assessExternalImageTrainingEligibility({
    ...verifiedAdultSelfSubject,
    adultStatus: 'unverified',
    modelRightsStatus: 'pending',
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('recognizable_human_adult_status_not_verified'));
  assert.ok(result.reasons.includes('recognizable_human_model_rights_not_verified'));
});

test('all-rights-reserved reference can never pass merely because it is visually useful', () => {
  const result = assessExternalImageTrainingEligibility({
    ...verifiedAdultSelfSubject,
    rightsStatus: 'all_rights_reserved',
    explicitAiTrainingPermission: false,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('rights_status_blocked:all_rights_reserved'));
});

test('Pexels and Unsplash ordinary routes require separate explicit AI permission', () => {
  for (const sourcePlatform of ['Pexels', 'Unsplash']) {
    const result = assessExternalImageTrainingEligibility({
      ...verifiedAdultSelfSubject,
      sourcePlatform,
      explicitAiTrainingPermission: false,
    });
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes('source_platform_ml_use_not_cleared'));
  }
});

test('mirrors and Wikimedia-style source substitution are rejected', () => {
  const result = assessExternalImageTrainingEligibility({
    ...verifiedAdultSelfSubject,
    sourcePlatform: 'Wikimedia Commons',
    explicitAiTrainingPermission: false,
    sourceIsOriginalCreatorLocation: false,
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('original_creator_source_required'));
  assert.ok(result.reasons.includes('source_platform_ml_use_not_cleared'));
});

test('assertion exposes fail-closed reasons', () => {
  assert.throws(
    () => assertExternalImageTrainingEligible({
      ...verifiedAdultSelfSubject,
      copyrightLicenseVerified: false,
      explicitAiTrainingPermission: false,
    }),
    /external_image_not_training_eligible/,
  );
});
