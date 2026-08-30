import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAutomaticModeratorCorrectionToPostDraft, buildAcceptedCorrectionModerationState, buildModeratedPublicationTaxonomy, deriveAcceptedCorrectionAppliedTriggers, deriveMandatoryAccessTriggers, validateAcceptedCorrectionPublicationTaxonomy, validateUploaderCorrectionAction } from '../uploaderCorrection.js';

const baseUpload = {
  userId: 'u1',
  requiresUploaderAcceptance: true,
  publicationStatus: 'needs_user_correction',
  reviewStatus: 'needs_user_correction',
  moderatorDecision: { action: 'requestUserCorrection' },
  correctedTaxonomy: { themes: ['Portrait'], triggers: ['adultArtNude'] },
  outcome: 'allowed',
  shouldReview: false,
};

test('acceptCorrection fails when corrected taxonomy is empty', () => {
  const result = validateUploaderCorrectionAction({ action: 'acceptCorrection', userId: 'u1', upload: { ...baseUpload, correctedTaxonomy: { themes: [], triggers: [] } } });
  assert.equal(result.ok, false);
});

test('acceptCorrection fails when upload is forbidden', () => {
  const result = validateUploaderCorrectionAction({ action: 'acceptCorrection', userId: 'u1', upload: { ...baseUpload, outcome: 'forbidden' } });
  assert.equal(result.ok, false);
});

test('acceptCorrection fails when owner mismatches', () => {
  const result = validateUploaderCorrectionAction({ action: 'acceptCorrection', userId: 'u2', upload: baseUpload });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('acceptCorrection succeeds for valid owned upload', () => {
  const result = validateUploaderCorrectionAction({ action: 'acceptCorrection', userId: 'u1', upload: baseUpload });
  assert.equal(result.ok, true);
  assert.deepEqual(result.correctedTaxonomy.themes, ['Portrait']);
});

test('rejectCorrection allowed and remains blocked state path', () => {
  const result = validateUploaderCorrectionAction({ action: 'rejectCorrection', userId: 'u1', upload: baseUpload });
  assert.equal(result.ok, true);
});

test('a rejected correction cannot later be accepted without a new moderator decision', () => {
  const result = validateUploaderCorrectionAction({
    action: 'acceptCorrection',
    userId: 'u1',
    upload: {
      ...baseUpload,
      publicationStatus: 'user_disagreed',
      uploaderCorrectionResponse: { status: 'rejected' },
      correction: { requiresModeratorReview: true },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('accepted correction taxonomy must match server-stored accepted values at publication', () => {
  const acceptedUpload = {
    ...baseUpload,
    uploaderCorrectionResponse: { status: 'accepted' },
    correction: {
      userAcceptedAt: { seconds: 1 },
      finalAcceptedThemes: ['Portrait'],
      finalAcceptedTriggers: ['adultArtNude'],
    },
  };
  const valid = validateAcceptedCorrectionPublicationTaxonomy({
    upload: acceptedUpload,
    postDraft: {
      styles: ['Portrait'],
      makerTags: ['adultArtNude'],
      appliedTriggers: ['adultArtNude'],
    },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.enforced, true);

  const extraStaleLabel = validateAcceptedCorrectionPublicationTaxonomy({
    upload: acceptedUpload,
    postDraft: {
      styles: ['Portrait'],
      makerTags: ['adultArtNude'],
      appliedTriggers: ['adultArtNude', 'bloodInjury'],
    },
  });
  assert.equal(extraStaleLabel.ok, false);
  assert.equal(extraStaleLabel.code, 'accepted_correction_taxonomy_mismatch');

  const bypass = validateAcceptedCorrectionPublicationTaxonomy({
    upload: acceptedUpload,
    postDraft: {
      styles: ['Fashion'],
      makerTags: [],
      appliedTriggers: [],
    },
  });
  assert.equal(bypass.ok, false);
  assert.equal(bypass.status, 409);
  assert.equal(bypass.code, 'accepted_correction_taxonomy_mismatch');
});

test('publication without an accepted correction is not taxonomy-locked', () => {
  const result = validateAcceptedCorrectionPublicationTaxonomy({
    upload: baseUpload,
    postDraft: { styles: ['Fashion'], makerTags: [], appliedTriggers: [] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.enforced, false);
});

test('Art Nude correction derives the mandatory adult access label', () => {
  assert.deepEqual(
    deriveMandatoryAccessTriggers({ themes: ['Art Nude'], triggers: [] }),
    ['adultArtNude']
  );

  const upload = {
    userSelectedTaxonomy: { themes: ['Fashion'], triggers: [] },
    moderatorDecision: {
      action: 'approveWithTaxonomyCorrection',
      correctedTaxonomy: { themes: ['Art Nude'], triggers: [] },
    },
  };
  const corrected = applyAutomaticModeratorCorrectionToPostDraft({
    upload,
    postDraft: { styles: ['Fashion'], makerTags: [], appliedTriggers: [] },
  });
  assert.deepEqual(corrected.styles, ['Art Nude']);
  assert.deepEqual(corrected.makerTags, []);
  assert.deepEqual(corrected.appliedTriggers, ['adultArtNude']);

  const validation = validateAcceptedCorrectionPublicationTaxonomy({ upload, postDraft: corrected });
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.acceptedTaxonomy.appliedTriggers, ['adultArtNude']);
});

test('kink correction derives the companion adult access label', () => {
  assert.deepEqual(
    deriveMandatoryAccessTriggers({ themes: ['Portrait'], triggers: ['kinkBdsm'] }),
    ['kinkBdsm', 'adultEroticSuggestive']
  );
});

test('automatic moderator taxonomy correction is locked at publication', () => {
  const upload = {
    userSelectedTaxonomy: { themes: ['Fashion'], triggers: ['adultArtNude'] },
    moderatorDecision: {
      action: 'approveWithTaxonomyCorrection',
      correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
    },
  };
  const valid = validateAcceptedCorrectionPublicationTaxonomy({
    upload,
    postDraft: { styles: ['Portrait'], makerTags: [], appliedTriggers: [] },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.enforced, true);

  const bypass = validateAcceptedCorrectionPublicationTaxonomy({
    upload,
    postDraft: { styles: ['Fashion'], makerTags: ['adultArtNude'], appliedTriggers: ['adultArtNude'] },
  });
  assert.equal(bypass.ok, false);
  assert.equal(bypass.code, 'accepted_correction_taxonomy_mismatch');
});

test('trigger-only requested correction preserves the existing theme on acceptance', () => {
  const result = validateUploaderCorrectionAction({
    action: 'acceptCorrection',
    userId: 'u1',
    upload: {
      ...baseUpload,
      postDraft: { styles: ['Portrait'], makerTags: [] },
      correctedTaxonomy: { themes: [], triggers: ['substanceDistress'] },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.correctedTaxonomy, { themes: ['Portrait'], triggers: ['substanceDistress'] });
});

test('automatic moderator correction is applied to a stale publication draft', () => {
  const result = applyAutomaticModeratorCorrectionToPostDraft({
    upload: {
      postDraft: { styles: ['Fashion'], makerTags: ['adultArtNude'], appliedTriggers: ['adultArtNude'] },
      moderatorDecision: { action: 'approveWithTaxonomyCorrection', correctedTaxonomy: { themes: ['Portrait'], triggers: [] } },
      correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
    },
    postDraft: { styles: ['Fashion'], makerTags: ['adultArtNude'], appliedTriggers: ['adultArtNude'] },
  });
  assert.deepEqual(result.styles, ['Portrait']);
  assert.deepEqual(result.makerTags, []);
  assert.deepEqual(result.appliedTriggers, []);
});

test('trigger-only automatic correction preserves the baseline theme', () => {
  const result = applyAutomaticModeratorCorrectionToPostDraft({
    upload: {
      postDraft: { styles: ['Portrait'], makerTags: [] },
      moderatorDecision: { action: 'approveWithTaxonomyCorrection', correctedTaxonomy: { themes: [], triggers: ['substanceDistress'] } },
      correctedTaxonomy: { themes: [], triggers: ['substanceDistress'] },
    },
    postDraft: { styles: ['Portrait'], makerTags: [], appliedTriggers: [] },
  });
  assert.deepEqual(result.styles, ['Portrait']);
  assert.deepEqual(result.makerTags, ['substanceDistress']);
  assert.deepEqual(result.appliedTriggers, ['substanceDistress']);
});

test('accepted correction moderation state clears stale blocking fields', () => {
  assert.deepEqual(buildAcceptedCorrectionModerationState(), {
    outcome: 'allowed',
    forbiddenReasons: [],
    shouldReview: false,
    publishBlocked: false,
    canRequestReview: false,
  });
});


test('accepted correction preserves fresh policy-owned safety warnings but not superseded adult taxonomy', () => {
  const upload = {
    ...baseUpload,
    correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
    uploaderCorrectionResponse: { status: 'accepted' },
    correction: {
      type: 'safeCorrection',
      userAcceptedAt: { seconds: 1 },
      finalAcceptedThemes: ['Portrait'],
      finalAcceptedTriggers: [],
    },
    policyAppliedTriggers: [
      { trigger: 'selfHarm', source: 'policySensitive' },
      { trigger: 'adultGraphicSensitive', source: 'policyAuto' },
      { trigger: 'adultEroticSuggestive', source: 'policyAuto' },
      { trigger: 'weapons', source: 'makerTag' },
      { trigger: 'bloodInjury' },
      'suicide',
    ],
  };
  const expected = deriveAcceptedCorrectionAppliedTriggers({
    upload,
    themes: ['Portrait'],
    triggers: [],
  });
  assert.deepEqual(expected, ['selfHarm', 'adultGraphicSensitive']);

  const corrected = applyAutomaticModeratorCorrectionToPostDraft({
    upload,
    postDraft: { styles: ['Portrait'], makerTags: [], appliedTriggers: [] },
  });
  assert.deepEqual(corrected.appliedTriggers, expected);

  const valid = validateAcceptedCorrectionPublicationTaxonomy({
    upload,
    postDraft: { styles: ['Portrait'], makerTags: [], appliedTriggers: expected },
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.acceptedTaxonomy.appliedTriggers, expected.sort());
});

test('fresh-evaluation lifecycle states cannot accept a stale correction', () => {
  for (const reviewStatus of ['freshEvalQueued', 'closedNoFingerprint', 'inReview', 'approved']) {
    const result = validateUploaderCorrectionAction({
      action: 'acceptCorrection',
      userId: 'u1',
      upload: {
        ...baseUpload,
        reviewStatus,
      },
    });
    if (reviewStatus === 'needs_user_correction') {
      assert.equal(result.ok, true);
    } else {
      assert.equal(result.ok, false, `reviewStatus ${reviewStatus} must not accept a correction`);
      assert.equal(result.status, 409);
    }
  }
});

test('ordinary publication is locked to the uploader taxonomy that was moderated', () => {
  const upload = {
    userSelectedTaxonomy: { themes: ['Portrait'], triggers: ['kinkBdsm'] },
    policyAppliedTriggers: [
      { trigger: 'adultEroticSuggestive', source: 'policyAuto' },
      { trigger: 'selfHarm', source: 'policySensitive' },
    ],
    suggestedTriggers: [{ trigger: 'bloodInjury', score: 0.8 }],
  };
  const valid = buildModeratedPublicationTaxonomy({
    upload,
    postDraft: {
      styles: ['Portrait'],
      makerTags: ['kinkBdsm'],
      appliedTriggers: ['kinkBdsm', 'bloodInjury'],
    },
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.themes, ['Portrait']);
  assert.deepEqual(valid.triggers, ['kinkBdsm']);
  assert.deepEqual(valid.appliedTriggers, ['adultEroticSuggestive', 'bloodInjury', 'kinkBdsm', 'selfHarm']);

  const changed = buildModeratedPublicationTaxonomy({
    upload,
    postDraft: { styles: ['Fashion'], makerTags: [], appliedTriggers: [] },
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.code, 'moderated_taxonomy_mismatch');
});

test('ordinary publication re-adds mandatory policy labels and rejects missing provenance', () => {
  const upload = {
    userSelectedTaxonomy: { themes: ['Art Nude'], triggers: [] },
    policyAppliedTriggers: [{ trigger: 'adultArtNude', source: 'policyAuto' }],
  };
  const result = buildModeratedPublicationTaxonomy({
    upload,
    postDraft: { styles: ['Art Nude'], makerTags: [], appliedTriggers: [] },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.appliedTriggers, ['adultArtNude']);

  const legacy = buildModeratedPublicationTaxonomy({
    upload: {},
    postDraft: { styles: [], makerTags: [], appliedTriggers: [] },
  });
  assert.equal(legacy.ok, false);
  assert.equal(legacy.code, 'moderated_taxonomy_missing');
});
