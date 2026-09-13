import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import { buildPersistedPublicationConsentProof, rehydratePersistedPublicationTimestamp, sanitizePersistedPublicationCorrection } from '../persistedPublication.js';

const makerRoles = [
  'photographer',
  'artist',
  'videographer',
  'retoucher',
  'art_director',
];

const consentStatuses = [
  'pending',
  'accepted',
  'rejected',
  'notRequired',
  'anonymous',
  'pressOrStreetException',
];

const validDraft = () => ({
  credits: [
    {
      role: 'photographer',
      name: 'Maker',
      isMaker: true,
      makerFunction: 'photographer',
      consentStatus: 'accepted',
    },
  ],
  uploadConsent: {
    version: 1,
    hasMaker: true,
    makerCreditIndex: 0,
    makerRoles: [...makerRoles],
    consentStatuses: [...consentStatuses],
    exception: { enabled: false, type: null, reason: '' },
    audit: [{ action: 'uploadConsentCaptured', actor: 'uploader' }],
  },
  consentAudit: [
    { action: 'uploadConsentCaptured', actor: 'uploader', actorUid: 'client-value' },
  ],
  consentException: { enabled: false, type: null, reason: '' },
});

test('persisted publication preserves consent proof and binds audit actor to uploader', () => {
  const result = buildPersistedPublicationConsentProof({ postDraft: validDraft(), userId: 'user-1' });
  assert.equal(result.ok, true);
  assert.equal(result.uploadConsent.version, 1);
  assert.equal(result.uploadConsent.hasMaker, true);
  assert.equal(result.consentAudit.length, 1);
  assert.equal(result.consentAudit[0].actorUid, 'user-1');
  assert.deepEqual(result.consentException, { enabled: false, type: null, reason: '' });
});

test('persisted publication requires exact version-one uploadConsent', () => {
  const missing = validDraft();
  delete missing.uploadConsent;
  assert.equal(buildPersistedPublicationConsentProof({ postDraft: missing, userId: 'user-1' }).code, 'upload_consent_missing');

  const stringVersion = validDraft();
  stringVersion.uploadConsent.version = '1';
  assert.equal(buildPersistedPublicationConsentProof({ postDraft: stringVersion, userId: 'user-1' }).code, 'upload_consent_missing');
});

test('persisted publication requires well-formed consent credits', () => {
  const empty = validDraft();
  empty.credits = [];
  assert.equal(buildPersistedPublicationConsentProof({ postDraft: empty, userId: 'user-1' }).code, 'consent_credits_missing');

  const malformed = validDraft();
  malformed.credits = ['not-a-credit', ...malformed.credits];
  malformed.uploadConsent.makerCreditIndex = 1;
  assert.equal(buildPersistedPublicationConsentProof({ postDraft: malformed, userId: 'user-1' }).code, 'consent_credits_invalid');
});

test('persisted publication mirrors canonical maker-credit proof instead of trusting isMaker alone', () => {
  const draft = validDraft();
  draft.credits[0] = {
    role: 'fan',
    isMaker: true,
    makerFunction: 'fan',
  };
  const result = buildPersistedPublicationConsentProof({ postDraft: draft, userId: 'user-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'consent_maker_invalid');
});

test('persisted publication accepts the canonical self-portrait maker exception', () => {
  const draft = validDraft();
  draft.credits[0] = {
    role: 'model',
    isSelf: true,
    isMaker: true,
    selfPortrait: true,
    makerFunction: null,
  };
  const result = buildPersistedPublicationConsentProof({ postDraft: draft, userId: 'user-1' });
  assert.equal(result.ok, true);
});

test('persisted publication requires maker-role and consent-status proof arrays', () => {
  const missingRole = validDraft();
  missingRole.uploadConsent.makerRoles = makerRoles.slice(0, -1);
  assert.equal(buildPersistedPublicationConsentProof({ postDraft: missingRole, userId: 'user-1' }).code, 'consent_maker_roles_invalid');

  const missingStatus = validDraft();
  missingStatus.uploadConsent.consentStatuses = consentStatuses.slice(0, -1);
  assert.equal(buildPersistedPublicationConsentProof({ postDraft: missingStatus, userId: 'user-1' }).code, 'consent_statuses_invalid');
});

test('persisted publication requires a consent audit trail', () => {
  const draft = validDraft();
  draft.consentAudit = [];
  const result = buildPersistedPublicationConsentProof({ postDraft: draft, userId: 'user-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'consent_audit_missing');
});

test('persisted publication rejects consent exception drift', () => {
  const draft = validDraft();
  draft.consentException = { enabled: true, type: 'streetPhotography', reason: 'street scene' };
  const result = buildPersistedPublicationConsentProof({ postDraft: draft, userId: 'user-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'consent_exception_mismatch');
  assert.equal(result.status, 409);
});

test('persisted publication accepts matching normalized exception proof', () => {
  const draft = validDraft();
  draft.consentException = { enabled: true, type: 'documentary', reason: '  documentary context  ' };
  draft.uploadConsent.exception = { enabled: true, type: 'documentary', reason: 'documentary context' };
  const result = buildPersistedPublicationConsentProof({ postDraft: draft, userId: 'user-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.consentException, {
    enabled: true,
    type: 'documentary',
    reason: 'documentary context',
  });
});


const transportedTimestamp = (seconds = 1_700_000_000, nanoseconds = 123_456_789) => ({
  type: 'firestore/timestamp/1.0',
  seconds,
  nanoseconds,
});

test('persisted publication rehydrates transported consent timestamps to Firestore Timestamp values', () => {
  const draft = validDraft();
  draft.credits[0].consentUpdatedAt = transportedTimestamp(1_700_000_001, 1);
  draft.uploadConsent.resolvedAt = transportedTimestamp(1_700_000_002, 2);
  draft.uploadConsent.missingMakerResolvedAt = transportedTimestamp(1_700_000_003, 3);
  draft.uploadConsent.selfMakerRoleConfirmedAt = transportedTimestamp(1_700_000_004, 4);
  draft.consentAudit[0].at = transportedTimestamp(1_700_000_005, 5);
  draft.consentAudit[0].resolvedAt = transportedTimestamp(1_700_000_006, 6);

  const result = buildPersistedPublicationConsentProof({ postDraft: draft, userId: 'user-1' });
  assert.equal(result.ok, true);
  assert.equal(result.credits[0].consentUpdatedAt instanceof Timestamp, true);
  assert.equal(result.uploadConsent.resolvedAt instanceof Timestamp, true);
  assert.equal(result.uploadConsent.missingMakerResolvedAt instanceof Timestamp, true);
  assert.equal(result.uploadConsent.selfMakerRoleConfirmedAt instanceof Timestamp, true);
  assert.equal(result.consentAudit[0].at instanceof Timestamp, true);
  assert.equal(result.consentAudit[0].resolvedAt instanceof Timestamp, true);
  assert.equal(result.consentAudit[0].at.nanoseconds, 5);
});

test('persisted publication rejects malformed transported consent timestamps', () => {
  const draft = validDraft();
  draft.consentAudit[0].at = { type: 'firestore/timestamp/1.0', seconds: '1700000000', nanoseconds: 0 };
  const result = buildPersistedPublicationConsentProof({ postDraft: draft, userId: 'user-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'consent_timestamp_invalid');
  assert.equal(result.status, 400);
});

test('timestamp rehydration accepts Admin timestamps, JSON timestamps and ISO legacy values', () => {
  const existing = Timestamp.fromMillis(1_700_000_000_000);
  assert.equal(rehydratePersistedPublicationTimestamp(existing), existing);
  assert.equal(rehydratePersistedPublicationTimestamp(transportedTimestamp()) instanceof Timestamp, true);
  assert.equal(rehydratePersistedPublicationTimestamp({ seconds: 1 }) instanceof Timestamp, true);
  assert.equal(rehydratePersistedPublicationTimestamp('2026-08-30T12:00:00.000Z') instanceof Timestamp, true);
  assert.equal(rehydratePersistedPublicationTimestamp({ type: 'unexpected', seconds: 1, nanoseconds: 0 }), null);
});

test('public correction timestamps are rehydrated and malformed accepted timestamps cannot manufacture acceptance', () => {
  const correction = sanitizePersistedPublicationCorrection({
    type: 'safeCorrection',
    userAcceptedAt: transportedTimestamp(),
  });
  assert.equal(correction.userAcceptedAt instanceof Timestamp, true);
  assert.equal(sanitizePersistedPublicationCorrection({
    userAcceptedAt: { type: 'firestore/timestamp/1.0', seconds: 'bad', nanoseconds: 0 },
  }), null);
});
