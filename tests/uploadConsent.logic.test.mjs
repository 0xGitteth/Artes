import assert from 'node:assert/strict';
import {
  CONTRIBUTOR_CONSENT_STATUSES,
  buildUploadConsent,
  getMakerCreditIndex,
  getSelfMakerRoles,
  hasMakerCredit,
  hasVisibleSubjectCredit,
  validateUploadConsent,
} from '../src/utils/uploadConsent.js';

assert.deepEqual(getSelfMakerRoles(['model', 'photographer', 'mua']), ['photographer']);
assert.equal(hasMakerCredit([{ role: 'model' }, { role: 'mua' }]), false, 'model plus MUA is not a maker credit');
assert.equal(hasMakerCredit([{ role: 'artist' }]), true, 'artist is an allowed maker role');
assert.equal(getMakerCreditIndex([{ role: 'model' }, { role: 'retoucher' }]), 1, 'maker index points at first maker credit');
assert.equal(getMakerCreditIndex([{ role: 'model' }, { role: 'mua' }]), -1, 'missing maker credit has no maker index');
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
assert.equal(consent.makerCreditIndex, 0);
assert.equal(consent.hasVisibleSubject, true);
assert.equal(consent.audit[0].pendingConsentCount, 1);

const streetConsent = buildUploadConsent({
  credits: [{ role: 'photographer', isSelf: true }, { role: 'model', name: 'Anonymous', isAnonymous: true }],
  exception: { enabled: true, type: 'streetPhotography', reason: 'Crowd in public square' },
});
assert.equal(streetConsent.makerCreditIndex, 0);
assert.equal(streetConsent.exception.type, 'streetPhotography');
assert.equal(streetConsent.consentStatuses.includes(CONTRIBUTOR_CONSENT_STATUSES.PRESS_OR_STREET_EXCEPTION), true);

const appendedMakerConsent = buildUploadConsent({
  credits: Array.from({ length: 10 }, (_, index) => ({ role: index % 2 === 0 ? 'model' : 'mua', name: `Non-maker ${index}` }))
    .concat({ role: 'videographer', name: 'Late maker' }),
});
assert.equal(appendedMakerConsent.hasMaker, true);
assert.equal(appendedMakerConsent.makerCreditIndex, 10);

const anonymousMakerConsent = buildUploadConsent({
  credits: [{ role: 'model', name: 'Subject' }, { role: 'artist', name: 'Anonymous maker', isAnonymous: true }],
});
assert.equal(anonymousMakerConsent.hasMaker, true);
assert.equal(anonymousMakerConsent.makerCreditIndex, 1);

const noMakerConsent = buildUploadConsent({
  credits: [{ role: 'model', name: 'Subject' }, { role: 'mua', name: 'Makeup' }],
});
assert.equal(noMakerConsent.hasMaker, false);
assert.equal(noMakerConsent.makerCreditIndex, -1);

console.log('PASS uploadConsent.logic.test');
