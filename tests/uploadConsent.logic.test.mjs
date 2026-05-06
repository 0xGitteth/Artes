import assert from 'node:assert/strict';
import {
  CONTRIBUTOR_CONSENT_STATUSES,
  buildUploadConsent,
  getSelfMakerRoles,
  hasMakerCredit,
  hasVisibleSubjectCredit,
  validateUploadConsent,
} from '../src/utils/uploadConsent.js';

assert.deepEqual(getSelfMakerRoles(['model', 'photographer', 'mua']), ['photographer']);
assert.equal(hasMakerCredit([{ role: 'model' }, { role: 'mua' }]), false, 'model plus MUA is not a maker credit');
assert.equal(hasMakerCredit([{ role: 'artist' }]), true, 'artist is an allowed maker role');
assert.equal(hasVisibleSubjectCredit([{ role: 'model' }]), true, 'model is a visible subject role');

const missingMaker = validateUploadConsent({
  credits: [{ role: 'model', isSelf: true }],
  uploaderRole: 'model',
  profileRoles: ['model'],
});
assert.equal(typeof missingMaker.maker, 'string');

const validSelfMaker = validateUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }],
  uploaderRole: 'photographer',
  profileRoles: ['photographer', 'model'],
});
assert.deepEqual(validSelfMaker, {});

const consent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Temporary' }],
  aiPeoplePresent: true,
  subjectWarningAcknowledged: true,
});
assert.equal(consent.hasMaker, true);
assert.equal(consent.hasVisibleSubject, true);
assert.equal(consent.audit[0].pendingConsentCount, 1);

const streetConsent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Anonymous', isAnonymous: true }],
  exception: { enabled: true, type: 'streetPhotography', reason: 'Crowd in public square' },
});
assert.equal(streetConsent.exception.type, 'streetPhotography');
assert.equal(streetConsent.consentStatuses.includes(CONTRIBUTOR_CONSENT_STATUSES.PRESS_OR_STREET_EXCEPTION), true);

console.log('PASS uploadConsent.logic.test');
