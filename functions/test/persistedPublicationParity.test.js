import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPersistedModerationDraftState,
  buildPersistedPublicationConsentProof,
  normalizePersistedPublicationStringList,
  resolveTrustedModeratedImageUrl,
  sanitizePersistedConsentDraftState,
  sanitizePersistedPendingInviteContributors,
  sanitizePersistedPublicationCorrection,
  sanitizePersistedPublicationImageMeta,
} from '../persistedPublication.js';

const makerRoles = ['photographer', 'artist', 'videographer', 'retoucher', 'art_director'];
const consentStatuses = ['pending', 'accepted', 'rejected', 'notRequired', 'anonymous', 'pressOrStreetException'];

const buildDraft = () => ({
  credits: [
    {
      role: 'photographer',
      name: 'Maker',
      uid: 'u1',
      contributorId: 'c1',
      isMaker: true,
      makerFunction: 'photographer',
      consentStatus: 'accepted',
      email: 'private@example.test',
      unsupportedSecret: 'nope',
    },
    { role: 'model', name: 'Model', contributorId: 'c1', consentStatus: 'accepted' },
  ],
  uploadConsent: {
    version: 1,
    hasMaker: true,
    makerCreditIndex: 0,
    makerRoles,
    consentStatuses,
    exception: { enabled: false, type: null, reason: '' },
  },
  consentAudit: [{ action: 'uploadConsentCaptured', actor: 'uploader' }],
  consentException: { enabled: false, type: null, reason: '' },
});

test('persisted publication sanitizes public credits and derives unique contributor ids', () => {
  const proof = buildPersistedPublicationConsentProof({ postDraft: buildDraft(), userId: 'u1' });
  assert.equal(proof.ok, true);
  assert.deepEqual(proof.contributorIds, ['c1']);
  assert.equal(proof.credits[0].email, undefined);
  assert.equal(proof.credits[0].unsupportedSecret, undefined);
  assert.equal(proof.credits[0].contributorId, 'c1');
  assert.equal(proof.credits[0].makerFunction, 'photographer');
});

test('persisted publication strips unsupported consent and audit fields', () => {
  const draft = buildDraft();
  draft.uploadConsent.privateToken = 'do-not-persist';
  draft.consentAudit[0].email = 'private@example.test';
  draft.consentAudit[0].internalNote = 'do-not-persist';
  const proof = buildPersistedPublicationConsentProof({ postDraft: draft, userId: 'u1' });
  assert.equal(proof.ok, true);
  assert.equal(proof.uploadConsent.privateToken, undefined);
  assert.equal(proof.consentAudit[0].email, undefined);
  assert.equal(proof.consentAudit[0].internalNote, undefined);
  assert.equal(proof.uploadConsent.audit[0].email, undefined);
  assert.equal(proof.consentAudit[0].actorUid, 'u1');
});

test('persisted publication image metadata is whitelisted and normalized', () => {
  assert.deepEqual(sanitizePersistedPublicationImageMeta({
    width: '3000',
    height: 1000,
    aspectRatio: 3,
    orientation: 'panorama',
    sizeBytes: 123456,
    email: 'do-not-persist@example.test',
  }), {
    width: 3000,
    height: 1000,
    aspectRatio: 3,
    sizeBytes: 123456,
    orientation: 'panorama',
  });
});


test('persisted publication canonicalizes taxonomy arrays and correction audit', () => {
  assert.deepEqual(normalizePersistedPublicationStringList([
    'bloodInjury',
    { trigger: 'selfHarm', email: 'private@example.test' },
    'bloodInjury',
    {},
  ]), ['bloodInjury', 'selfHarm']);
  const correction = sanitizePersistedPublicationCorrection({
    type: 'safe',
    userAcceptedAt: { seconds: 1 },
    suggestedThemes: ['Portrait'],
    finalAcceptedTriggers: [{ trigger: 'bloodInjury', secret: 'x' }],
    reason: 'ok',
    reviewCaseId: 'private-case-id',
    moderatorNoteInternal: 'private',
  });
  assert.deepEqual(correction.finalAcceptedTriggers, ['bloodInjury']);
  assert.equal(correction.type, 'safeCorrection');
  assert.equal(correction.reviewCaseId, undefined);
  assert.equal(correction.moderatorNoteInternal, undefined);
});


test('accepted legacy correction without a type is canonicalized to a rule-valid safe correction', () => {
  const correction = sanitizePersistedPublicationCorrection({
    userAcceptedAt: { seconds: 1 },
    finalAcceptedThemes: ['Portrait'],
    finalAcceptedTriggers: [],
  });
  assert.equal(correction.type, 'safeCorrection');
});

test('non-accepted correction with an unknown type is not published', () => {
  assert.equal(sanitizePersistedPublicationCorrection({ type: 'internalOnly', suggestedThemes: ['Portrait'] }), null);
});

test('taxonomy arrays alone do not manufacture an accepted correction state', () => {
  assert.equal(sanitizePersistedPublicationCorrection({
    type: 'legacyUnknown',
    finalAcceptedThemes: ['Portrait'],
    finalAcceptedTriggers: [],
  }), null);
});

test('persisted moderation drafts bind media to the server upload and normalize continuity state', () => {
  const result = buildPersistedModerationDraftState({
    upload: { imageUrl: 'https://trusted.example/moderated.jpg' },
    draft: {
      imageUrl: 'https://attacker.example/unmoderated.jpg',
      imageRef: 'attacker-path',
      storagePath: 'attacker-path',
      imageMeta: { width: '1200', height: 800, private: 'x' },
      pendingInviteContributors: [
        { contributorId: 'c1', displayName: 'Contributor', email: 'private@example.test' },
        { displayName: 'missing id' },
      ],
      consentException: { enabled: true, type: 'documentary', reason: ' context ' },
      aiPeoplePresent: true,
      subjectWarningAcknowledged: true,
      missingMakerPromptShown: true,
      selectedSelfMakerRole: 'artist',
      pendingSelfMakerRole: 'retoucher',
      selfMakerRoleConfirmation: { confirmed: true, role: 'artist', confirmedAt: '2026-08-28T00:00:00.000Z' },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.draft.imageUrl, 'https://trusted.example/moderated.jpg');
  assert.equal(result.draft.imageRef, undefined);
  assert.equal(result.draft.storagePath, undefined);
  assert.deepEqual(result.draft.imageMeta, { width: 1200, height: 800 });
  assert.deepEqual(result.draft.pendingInviteContributors, [{ contributorId: 'c1', displayName: 'Contributor' }]);
  assert.equal(result.draft.consentException.type, 'documentary');
  assert.equal(result.draft.aiPeoplePresent, true);
  assert.equal(result.draft.selfMakerRoleConfirmation.role, 'artist');
  assert.equal(resolveTrustedModeratedImageUrl({ imageUrl: 'https://trusted.example/a.jpg', previewUrl: 'https://trusted.example/b.jpg' }), 'https://trusted.example/a.jpg');
});

test('persisted moderation draft helpers fail closed and normalize malformed consent/invites', () => {
  const missingMedia = buildPersistedModerationDraftState({ upload: {}, draft: { imageUrl: 'https://client.example/x.jpg' } });
  assert.equal(missingMedia.ok, false);
  assert.equal(missingMedia.code, 'moderated_image_missing');
  assert.deepEqual(sanitizePersistedPendingInviteContributors([null, 'x', { contributorId: ' c1 ', displayName: ' Name ' }]), [
    { contributorId: 'c1', displayName: 'Name' },
  ]);
  const consent = sanitizePersistedConsentDraftState({
    consentException: { enabled: true, type: 'not-real', reason: 'ignored' },
    selectedSelfMakerRole: 'not-real',
    selfMakerRoleConfirmation: { confirmed: true, role: 'not-real' },
  });
  assert.equal(consent.consentException.enabled, false);
  assert.equal(consent.selectedSelfMakerRole, 'photographer');
  assert.deepEqual(consent.selfMakerRoleConfirmation, { confirmed: false, role: '', confirmedAt: null });
});
